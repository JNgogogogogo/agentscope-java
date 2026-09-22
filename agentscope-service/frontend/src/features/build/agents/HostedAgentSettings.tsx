/*
 * Copyright 2024-2026 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  getHostedAgentSettings,
  listHostedRuntimeOptions,
  updateAgent,
  updateHostedAgentSettings,
  type AgentDefinition,
  type HostedExecutionOverrides,
} from '@/api/agents';
import { useControlPlaneScope } from '@/app/ScopeContext';
import { JsonViewer } from '@/components/JsonViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';

import { RuntimeHostCapacity } from './RuntimeHostCapacity';

const reasoningLevels = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const claudePermissionModes = [
  ['', '运行时 Profile 默认值'],
  ['default', '默认 —— 敏感操作需询问'],
  ['acceptEdits', '接受编辑 —— 批准 Workspace 编辑'],
  ['dontAsk', '不询问 —— 拒绝需要审批的操作'],
  ['plan', 'Plan —— 只读规划'],
] as const;

const qoderPermissionModes = [
  ['', '运行时 Profile 默认值'],
  ['default', '默认 —— 使用显式允许规则'],
  ['auto', '自动 —— 无需人工介入的策略决策'],
  ['accept_edits', '接受编辑 —— 批准 Workspace 编辑'],
  ['bypass_permissions', 'Full access — allow tools without approval'],
  ['dont_ask', '不询问 —— 拒绝需要审批的操作'],
] as const;

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function commandHeader(provider: string) {
  if (provider === 'codex') return 'codex app-server';
  if (provider === 'claude-code') return 'claude -p';
  if (provider === 'qoder') return 'qodercli -p';
  if (provider === 'qwenpaw') return 'qwenpaw acp';
  if (provider === 'openclaw') return 'openclaw agent exec';
  return provider;
}

function quoteArgument(value: string) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function StringListSetting({ label, value, disabled, placeholder, description, onChange }: {
  label: string;
  value: unknown;
  disabled: boolean;
  placeholder?: string;
  description?: string;
  onChange: (value: string[] | '') => void;
}) {
  return <label className="grid gap-1.5 text-sm">
    <span className="font-medium">{label}</span>
    <Textarea
      className="min-h-20 font-mono text-xs"
      value={stringList(value).join('\n')}
      disabled={disabled}
      placeholder={placeholder}
      onChange={event => {
        const items = event.target.value.split('\n').map(item => item.trim()).filter(Boolean);
        onChange(items.length > 0 ? items : '');
      }}
    />
    {description && <span className="text-xs text-muted-foreground">{description}</span>}
  </label>;
}

function BooleanSetting({ label, value, disabled, description, onChange }: {
  label: string;
  value: unknown;
  disabled: boolean;
  description?: string;
  onChange: (value: boolean | '') => void;
}) {
  const selected = typeof value === 'boolean' ? String(value) : '';
  return <label className="grid gap-1.5 text-sm">
    <span className="font-medium">{label}</span>
    <select className="h-10 rounded-md border bg-background px-3" value={selected} disabled={disabled} onChange={event => {
      onChange(event.target.value === '' ? '' : event.target.value === 'true');
    }}>
      <option value="">运行时 Profile 默认值</option>
      <option value="true">已启用</option>
      <option value="false">已停用</option>
    </select>
    {description && <span className="text-xs text-muted-foreground">{description}</span>}
  </label>;
}

function PermissionModeSetting({ provider, value, disabled, onChange }: {
  provider: 'claude-code' | 'qoder';
  value: unknown;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const options = provider === 'qoder' ? qoderPermissionModes : claudePermissionModes;
  return <label className="grid gap-1.5 text-sm">
    <span className="font-medium">权限模式</span>
    <select className="h-10 rounded-md border bg-background px-3" value={String(value ?? '')} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {options.map(([mode, label]) => <option key={mode || 'inherit'} value={mode}>{label}</option>)}
    </select>
    {provider === 'claude-code' && <span className="text-xs text-muted-foreground">危险权限绕过模式刻意不作为 Agent 级预设提供。</span>}
    {provider === 'qoder' && value === 'bypass_permissions' && <span className="text-xs text-muted-foreground">工具在无 Qoder 审批提示的情况下运行，使用 Host 进程的权限。保存后对新执行生效。</span>}
    {provider === 'qoder' && <span className="text-xs text-muted-foreground">默认模式下，敏感工具请求会转发到 AgentScope 审批。自动模式可能无需人工审核直接决策。</span>}
  </label>;
}

export function HostedAgentSettings({ agent, canEdit }: { agent: AgentDefinition; canEdit: boolean }) {
  const scope = useControlPlaneScope();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['hosted-agent-settings', agent.id],
    queryFn: () => getHostedAgentSettings(agent.id),
  });
  const runtimesQuery = useQuery({
    queryKey: ['hosted-runtime-options', scope.tenant, scope.namespace],
    queryFn: () => listHostedRuntimeOptions(scope.tenant, scope.namespace),
  });
  const [runtimeId, setRuntimeId] = useState('');
  const [model, setModel] = useState(agent.model ?? '');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [serviceTier, setServiceTier] = useState('');
  const [maxConcurrency, setMaxConcurrency] = useState('0');
  const [providerConfiguration, setProviderConfiguration] = useState<Record<string, unknown>>({});
  const [customArgsText, setCustomArgsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();

  const settings = settingsQuery.data;
  const runtimes = runtimesQuery.data?.runtimes ?? [];
  useEffect(() => {
    if (!settings) return;
    setRuntimeId(`${settings.runtimeProfile.id}:${settings.runtimePool.id}`);
    setReasoningEffort(settings.executionOverrides?.reasoningEffort ?? '');
    setServiceTier(settings.executionOverrides?.serviceTier ?? '');
    setMaxConcurrency(String(settings.maxConcurrency || 0));
    setProviderConfiguration(configObject(settings.executionOverrides?.providerConfiguration));
    setCustomArgsText((settings.executionOverrides?.customArgs ?? []).join('\n'));
  }, [settings]);
  useEffect(() => setModel(agent.model ?? ''), [agent.model, agent.version]);

  const selectedRuntime = runtimes.find(runtime => runtime.id === runtimeId);
  const provider = selectedRuntime?.provider ?? settings?.runtimeProfile.provider ?? '';
  const customArgs = customArgsText.split('\n').map(value => value.trim()).filter(Boolean);
  const resolvedConfiguration = useMemo(() => ({
    ...configObject(settings?.runtimeProfile.configuration),
    ...providerConfiguration,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  }), [providerConfiguration, reasoningEffort, serviceTier, settings?.runtimeProfile.configuration]);

  const setProviderValue = (key: string, value: unknown) => {
    setProviderConfiguration(current => {
      const next = { ...current };
      if (value === '' || value == null) delete next[key]; else next[key] = value;
      return next;
    });
  };

  async function save() {
    if (!settings) return;
    const runtime = runtimes.find(item => item.id === runtimeId);
    const profileId = runtime?.runtimeProfileId ?? settings.runtimeProfile.id;
    const poolId = runtime?.runtimePoolId ?? settings.runtimePool.id;
    const parsedConcurrency = Number(maxConcurrency);
    if (!Number.isInteger(parsedConcurrency) || parsedConcurrency < 0 || parsedConcurrency > 50) {
      setMessage({ tone: 'error', text: '并发数必须是 0 到 50 之间的整数。' });
      return;
    }
    setSaving(true);
    setMessage(undefined);
    try {
      const executionOverrides: HostedExecutionOverrides = {
        reasoningEffort: reasoningEffort || undefined,
        serviceTier: serviceTier || undefined,
        providerConfiguration,
        customArgs,
      };
      await updateHostedAgentSettings(agent.id, {
        runtimeProfileId: profileId,
        runtimePoolId: poolId,
        executionOverrides,
        maxConcurrency: parsedConcurrency,
        bindingVersion: settings.bindingVersion,
        policyVersion: settings.policyVersion,
      });
      if (model !== (agent.model ?? '')) {
        if (agent.version == null) throw new Error('缺少 Agent 定义版本');
        await updateAgent(agent.id, { name: agent.name, model, version: agent.version });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hosted-agent-settings', agent.id] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-agent', agent.id] }),
        queryClient.invalidateQueries({ queryKey: ['catalog-agent-overview', agent.id] }),
      ]);
      setMessage({ tone: 'ok', text: 'Hosted execution settings saved. New attempts use the updated configuration.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '保存设置失败' });
    } finally {
      setSaving(false);
    }
  }

  if (settingsQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载 Hosted 设置…</p>;
  if (!settings) return <p className="text-sm text-red-600">{settingsQuery.error instanceof Error ? settingsQuery.error.message : 'Hosted settings are unavailable.'}</p>;

  return <div className="grid gap-5">
    <Card>
      <CardHeader><CardTitle>执行</CardTitle><CardDescription>在共享运行时 Profile 之上的 Agent 级选择。已有的尝试保留其冻结快照。</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <label className="grid gap-1.5 text-sm"><span className="font-medium">运行时</span><select className="h-10 rounded-md border bg-background px-3" value={runtimeId} disabled={!canEdit} onChange={event => {
          setRuntimeId(event.target.value); setModel(''); setReasoningEffort(''); setServiceTier(''); setProviderConfiguration({});
        }}>{!runtimes.some(runtime => runtime.id === runtimeId) && <option value={runtimeId}>{settings.runtimeProfile.provider} · {settings.runtimePool.name}</option>}{runtimes.map(runtime => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm"><span className="font-medium">Model</span><Input value={model} disabled={!canEdit} onChange={event => setModel(event.target.value)} placeholder="跟随运行时 / CLI 配置" /></label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-1.5 text-sm"><span className="font-medium">思考</span><select className="h-10 rounded-md border bg-background px-3" value={reasoningEffort} disabled={!canEdit} onChange={event => setReasoningEffort(event.target.value)}>{reasoningLevels.map(level => <option key={level || 'default'} value={level}>{level || '跟随 CLI 配置'}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">速度</span><select className="h-10 rounded-md border bg-background px-3" value={serviceTier} disabled={!canEdit || provider !== 'codex'} onChange={event => setServiceTier(event.target.value)}><option value="">运行时默认值</option><option value="priority">Priority / fast</option></select></label>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">Agent 并发数</span><Input type="number" min="0" max="50" value={maxConcurrency} disabled={!canEdit} onChange={event => setMaxConcurrency(event.target.value)} /><span className="text-xs text-muted-foreground">Per-Agent limit. 0 uses the scheduler default; maximum 50. Host capacity can further limit parallel execution.</span></label>
        </div>
      </CardContent>
    </Card>

    <RuntimeHostCapacity poolName={settings.runtimePool.name} />

    <Card>
      <CardHeader><CardTitle>服务商设置</CardTitle><CardDescription>Structured overrides for {provider || 'the selected provider'}; the shared profile remains unchanged.</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        {provider === 'codex' && <>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">Codex Profile</span><Input value={String(providerConfiguration.profile ?? '')} disabled={!canEdit} onChange={event => setProviderValue('profile', event.target.value)} placeholder="Follow ~/.codex/config.toml" /><span className="text-xs text-muted-foreground">Optional named Codex profile. Leave blank to inherit the local CLI configuration.</span></label>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">沙箱</span><select className="h-10 rounded-md border bg-background px-3" value={String(providerConfiguration.sandbox ?? '')} disabled={!canEdit} onChange={event => setProviderValue('sandbox', event.target.value)}><option value="">运行时 Profile 默认值</option><option value="read-only">read-only</option><option value="workspace-write">workspace-write</option></select><span className="text-xs text-muted-foreground">Agent 可以让 Profile 沙箱更严格，但不能放宽它。</span></label>
          <span className="text-xs text-muted-foreground">Codex app-server 原生支持 AgentScope 创建的非 Git Workspace，并将敏感操作审批路由到控制面。</span>
        </>}
        {provider === 'claude-code' && <>
          <PermissionModeSetting provider="claude-code" value={providerConfiguration.permissionMode} disabled={!canEdit} onChange={value => setProviderValue('permissionMode', value)} />
          <StringListSetting label="允许的工具" value={providerConfiguration.allowedTools} disabled={!canEdit} onChange={value => setProviderValue('allowedTools', value)} placeholder={'mcp__agentscope-collaboration__*\nRead\nGrep'} description="每行一条 Claude 工具规则。AgentScope 协作已由自动运行时 Profile 预先授权。" />
          <StringListSetting label="禁止的工具" value={providerConfiguration.disallowedTools} disabled={!canEdit} onChange={value => setProviderValue('disallowedTools', value)} placeholder={'Bash(rm -rf:*)'} description="拒绝规则优先于允许规则。" />
          <label className="grid gap-1.5 text-sm"><span className="font-medium">最大轮数</span><Input type="number" min="0" value={String(providerConfiguration.maxTurns ?? '')} disabled={!canEdit} onChange={event => setProviderValue('maxTurns', event.target.value ? Number(event.target.value) : '')} placeholder="服务商默认值" /><span className="text-xs text-muted-foreground">限制无人值守的 Agent 循环；0 或留空则遵循运行时 Profile。</span></label>
        </>}
        {provider === 'qoder' && <>
          <PermissionModeSetting provider="qoder" value={providerConfiguration.permissionMode} disabled={!canEdit} onChange={value => setProviderValue('permissionMode', value)} />
          <StringListSetting label="允许的工具" value={providerConfiguration.allowedTools} disabled={!canEdit} onChange={value => setProviderValue('allowedTools', value)} placeholder={'mcp__agentscope-collaboration__*\nRead\nGrep'} description="每行一条 Qoder 权限规则。精确的允许规则可让无人值守任务可用，而无需启用 YOLO 模式。" />
          <StringListSetting label="禁止的工具" value={providerConfiguration.disallowedTools} disabled={!canEdit} onChange={value => setProviderValue('disallowedTools', value)} placeholder={'Bash(rm -rf:*)'} description="拒绝与安全规则优先于允许规则。" />
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-1.5 text-sm"><span className="font-medium">最大轮数</span><Input type="number" min="0" value={String(providerConfiguration.maxTurns ?? '')} disabled={!canEdit} onChange={event => setProviderValue('maxTurns', event.target.value ? Number(event.target.value) : '')} placeholder="默认" /></label>
            <label className="grid gap-1.5 text-sm"><span className="font-medium">最大输出 Token 数</span><Input type="number" min="0" value={String(providerConfiguration.maxOutputTokens ?? '')} disabled={!canEdit} onChange={event => setProviderValue('maxOutputTokens', event.target.value ? Number(event.target.value) : '')} placeholder="默认" /></label>
            <label className="grid gap-1.5 text-sm"><span className="font-medium">上下文窗口</span><Input type="number" min="0" value={String(providerConfiguration.contextWindow ?? '')} disabled={!canEdit} onChange={event => setProviderValue('contextWindow', event.target.value ? Number(event.target.value) : '')} placeholder="Model default" /></label>
          </div>
          <BooleanSetting label="严格 MCP 配置" value={providerConfiguration.strictMCPConfig} disabled={!canEdit} onChange={value => setProviderValue('strictMCPConfig', value)} description="本次尝试仅使用由 AgentScope 实体化的 MCP 服务器；在自动 Qoder Profile 中启用。" />
          <label className="grid gap-1.5 text-sm"><span className="font-medium">Qoder Agent</span><Input value={String(providerConfiguration.agent ?? '')} disabled={!canEdit} onChange={event => setProviderValue('agent', event.target.value)} placeholder="默认 Agent" /><span className="text-xs text-muted-foreground">Optional installed Qoder Agent name passed through --agent.</span></label>
        </>}
        {provider === 'qwenpaw' && <>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">QwenPaw Agent</span><Input value={String(providerConfiguration.agent ?? '')} disabled={!canEdit} onChange={event => setProviderValue('agent', event.target.value)} placeholder="默认 Agent" /></label>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">运行时服务商</span><Input value={String(providerConfiguration.runtimeProvider ?? '')} disabled={!canEdit} onChange={event => setProviderValue('runtimeProvider', event.target.value)} placeholder="QwenPaw 默认值" /></label>
          <BooleanSetting label="本地诊断" value={providerConfiguration.localDiagnostics} disabled={!canEdit} onChange={value => setProviderValue('localDiagnostics', value)} description="Include QwenPaw local diagnostic events for troubleshooting." />
        </>}
        {provider === 'openclaw' && <>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-1.5 text-sm"><span className="font-medium">思考</span><select className="h-10 rounded-md border bg-background px-3" value={String(providerConfiguration.thinking ?? '')} disabled={!canEdit} onChange={event => setProviderValue('thinking', event.target.value)}><option value="">跟随模型默认值</option>{['minimal', 'low', 'medium', 'high', 'xhigh'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="grid gap-1.5 text-sm"><span className="font-medium">代码模式</span><select className="h-10 rounded-md border bg-background px-3" value={String(providerConfiguration.codeMode ?? '')} disabled={!canEdit} onChange={event => setProviderValue('codeMode', event.target.value)}><option value="">运行时 Profile 默认值</option><option value="direct">direct</option><option value="auto">auto</option><option value="code">code</option></select></label>
            <label className="grid gap-1.5 text-sm"><span className="font-medium">超时秒数</span><Input type="number" min="0" value={String(providerConfiguration.timeoutSeconds ?? '')} disabled={!canEdit} onChange={event => setProviderValue('timeoutSeconds', event.target.value ? Number(event.target.value) : '')} placeholder="600" /></label>
          </div>
          <StringListSetting label="备用模型" value={providerConfiguration.fallbacks} disabled={!canEdit} onChange={value => setProviderValue('fallbacks', value)} placeholder={'anthropic/claude-sonnet\nollama/qwen'} description="One provider/model per line, tried in order after the primary model." />
          <div className="grid gap-4 md:grid-cols-3">
            <BooleanSetting label="本地模型精简工具" value={providerConfiguration.localModelLean} disabled={!canEdit} onChange={value => setProviderValue('localModelLean', value)} />
            <BooleanSetting label="隔离配置" value={providerConfiguration.isolated} disabled={!canEdit} onChange={value => setProviderValue('isolated', value)} description="忽略环境中的 OpenClaw 配置。" />
            <BooleanSetting label="仅使用环境变量鉴权" value={providerConfiguration.authEnvOnly} disabled={!canEdit} onChange={value => setProviderValue('authEnvOnly', value)} description="忽略已存储的和外部 CLI 凭据。" />
          </div>
        </>}
        {!['codex', 'claude-code', 'qoder', 'qwenpaw', 'openclaw'].includes(provider) && <p className="text-sm text-muted-foreground">该服务商目前仅暴露模型与执行偏好。受支持的非保留 CLI 选项请使用「自定义参数」。</p>}
      </CardContent>
    </Card>

    <Card>
      <details>
        <summary className="cursor-pointer list-none"><CardHeader><CardTitle>高级 CLI 参数</CardTitle><CardDescription>为尚未提供结构化字段的受支持服务商参数预留的补充入口。</CardDescription></CardHeader></summary>
        <CardContent className="grid gap-4">
          <p className="text-xs text-muted-foreground">每行一个 argv token。Workspace、model、sandbox、protocol、resume、MCP 与 permission 参数由 AgentScope 保留。</p>
          <Textarea className="min-h-32 font-mono text-xs" value={customArgsText} disabled={!canEdit} onChange={event => setCustomArgsText(event.target.value)} placeholder={'--profile\nwork'} />
          <div><div className="mb-2 text-sm font-medium">自定义参数预览</div><code className="block overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{[commandHeader(provider), ...customArgs.map(quoteArgument)].join(' ')}</code></div>
        </CardContent>
      </details>
    </Card>

    <Card>
      <CardHeader><CardTitle>生效配置预览</CardTitle><CardDescription>Profile v{settings.runtimeProfile.version} baseline plus this Agent's structured overrides. The immutable attempt snapshot is authoritative after dispatch.</CardDescription></CardHeader>
      <CardContent><JsonViewer value={resolvedConfiguration} className="max-h-72" /></CardContent>
    </Card>

    <div className="flex items-center justify-end gap-3">{message && <span className={`mr-auto text-sm ${message.tone === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{message.text}</span>}<Button onClick={() => void save()} disabled={!canEdit || saving}>{saving ? '保存中…' : '保存设置'}</Button></div>
  </div>;
}

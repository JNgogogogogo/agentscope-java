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

/*
 * Copyright 2024-2026 the original author or authors.
 * Licensed under the Apache License, Version 2.0.
 */

import { ArrowLeft, Bot, Cpu, FolderKanban, Sparkles, Wrench } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AgentCreateRequest,
  DiscoveredRuntimeOption,
  RuntimeCapabilityDescriptor,
  createAgent,
  listHostedRuntimeOptions,
} from '../api/agents';
import { listEnvironments } from '../api/environments';
import { getWorkspace, listWorkspaces, WorkspaceSummary } from '../api/workspaces';
import { useControlPlaneScope } from '../app/ScopeContext';

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100%', background: '#fbfbfc', color: '#18181b', paddingBottom: 96 },
  header: {
    position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 20, padding: '18px 28px', background: 'rgba(251,251,252,.94)',
    backdropFilter: 'blur(12px)', borderBottom: '1px solid #e4e4e7',
  },
  headerMain: { display: 'flex', gap: 14, alignItems: 'center' },
  back: { border: 0, background: 'transparent', padding: 6, cursor: 'pointer', color: '#3f3f46' },
  title: { margin: 0, fontSize: 22, lineHeight: 1.2, fontWeight: 650, letterSpacing: '-.02em' },
  subtitle: { margin: '3px 0 0', color: '#71717a', fontSize: 14 },
  headerPill: { borderRadius: 999, padding: '7px 12px', background: '#f4f4f5', color: '#52525b', fontSize: 13 },
  content: { width: 'min(920px, calc(100% - 48px))', margin: '0 auto', padding: '38px 0' },
  section: { marginBottom: 38 },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 9, margin: 0, fontSize: 17, fontWeight: 650 },
  sectionHint: { margin: '7px 0 15px', color: '#71717a', fontSize: 14, lineHeight: 1.5 },
  card: { border: '1px solid #e4e4e7', background: '#fff', borderRadius: 16, overflow: 'hidden' },
  row: {
    display: 'grid', gridTemplateColumns: '210px minmax(0, 1fr)', gap: 24,
    padding: '22px 24px', borderBottom: '1px solid #eeeeef', alignItems: 'start',
  },
  lastRow: { borderBottom: 0 },
  label: { paddingTop: 10, fontSize: 14, fontWeight: 600, color: '#27272a' },
  input: {
    width: '100%', boxSizing: 'border-box', border: '1px solid #d4d4d8', borderRadius: 10,
    background: '#fff', padding: '11px 13px', fontSize: 15, color: '#18181b', outline: 'none',
  },
  textarea: {
    width: '100%', boxSizing: 'border-box', minHeight: 190, resize: 'vertical',
    border: '1px solid #d4d4d8', borderRadius: 10, background: '#fff', padding: '13px 14px',
    fontSize: 14, lineHeight: 1.6, color: '#18181b', outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  hint: { marginTop: 7, color: '#71717a', fontSize: 12.5, lineHeight: 1.5 },
  capabilityList: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 },
  capability: { border: '1px solid #e4e4e7', background: '#fafafa', borderRadius: 999, padding: '5px 9px', fontSize: 12, color: '#52525b' },
  preview: { marginTop: 11, padding: '12px 13px', borderRadius: 10, background: '#fafafa', border: '1px solid #eeeeef', fontSize: 13, color: '#52525b', lineHeight: 1.55 },
  details: { border: '1px solid #e4e4e7', background: '#fff', borderRadius: 14, padding: '4px 20px' },
  summary: { cursor: 'pointer', padding: '15px 0', fontWeight: 600, fontSize: 14 },
  footer: {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 12, display: 'flex', justifyContent: 'flex-end',
    gap: 10, padding: '14px 28px', background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(12px)', borderTop: '1px solid #e4e4e7',
  },
  primary: { border: 0, borderRadius: 10, background: '#18181b', color: '#fff', padding: '10px 18px', fontWeight: 600, cursor: 'pointer' },
  disabled: { background: '#d4d4d8', cursor: 'not-allowed' },
  secondary: { border: '1px solid #d4d4d8', borderRadius: 10, background: '#fff', color: '#3f3f46', padding: '10px 16px', fontWeight: 600, cursor: 'pointer' },
  error: { alignSelf: 'center', marginRight: 'auto', color: '#b91c1c', fontSize: 13 },
};

const managedRuntime: DiscoveredRuntimeOption = {
  id: 'managed', name: 'AgentScope Managed', provider: 'agentscope', runtimeProfileId: '', runtimePoolId: '', hostCount: 1,
  capabilities: {
    displayName: 'AgentScope Managed', instructions: { supported: true, mode: 'native' },
    workspace: { supported: true, mode: 'native' }, skills: { supported: true, mode: 'native' },
    tools: { supported: true, mode: 'native' }, mcp: { supported: true, mode: 'native' },
    model: { supported: true, mode: 'registry' }, resume: true,
  },
};

function capabilityLabels(capabilities?: RuntimeCapabilityDescriptor): string[] {
  if (!capabilities) return [];
  const labels: string[] = [];
  if (capabilities.workspace?.supported) labels.push('Workspace');
  if (capabilities.skills?.supported) labels.push('技能');
  if (capabilities.tools?.supported) labels.push('工具');
  if (capabilities.mcp?.supported) labels.push('MCP');
  if (capabilities.resume) labels.push('继续');
  return labels;
}

function capabilityDetails(capabilities?: RuntimeCapabilityDescriptor): string {
  if (!capabilities) return '';
  const describe = (label: string, capability?: { supported: boolean; mode?: string; target?: string }) => {
    if (!capability?.supported) return `${label}: unavailable`;
    if (capability.target) return `${label} → ${capability.target}`;
    return `${label}: ${(capability.mode || 'native').replace(/-/g, ' ')}`;
  };
  return [
    describe('指令', capabilities.instructions),
    describe('技能', capabilities.skills),
    describe('工具', capabilities.tools),
    describe('MCP', capabilities.mcp),
    `Session resume: ${capabilities.resume ? 'supported' : 'one-shot'}`,
  ].join(' · ');
}

export default function AgentCreatePage() {
  const navigate = useNavigate();
  const scope = useControlPlaneScope();
  const [name, setName] = useState('');
  const [agentKey, setAgentKey] = useState('');
  const [agentKeyCustomized, setAgentKeyCustomized] = useState(false);
  const [executionId, setExecutionId] = useState('managed');
  const [executionCustomized, setExecutionCustomized] = useState(false);
  const [runtimes, setRuntimes] = useState<DiscoveredRuntimeOption[]>([]);
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [preview, setPreview] = useState<WorkspaceSummary | null>(null);
  const [defaultEnvironmentId, setDefaultEnvironmentId] = useState('');
  const [environments, setEnvironments] = useState<{ id: string; name: string; type: string }[]>([]);
  const [sysPrompt, setSysPrompt] = useState('');
  const [model, setModel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listWorkspaces().then(setWorkspaces).catch(() => undefined);
    listEnvironments().then(setEnvironments).catch(() => undefined);
    listHostedRuntimeOptions(scope.tenant, scope.namespace).then(result => {
      const discovered = result.runtimes ?? [];
      setRuntimes(discovered);
      if (!executionCustomized && discovered.length > 0) {
        setExecutionId((discovered.find(runtime => runtime.provider === 'codex') ?? discovered[0]).id);
      }
    }).catch(() => undefined);
  }, [executionCustomized, scope.tenant, scope.namespace]);

  useEffect(() => {
    if (!workspaceId) { setPreview(null); return; }
    let cancelled = false;
    getWorkspace(workspaceId).then(w => { if (!cancelled) setPreview(w); }).catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const execution = useMemo(
    () => executionId === 'managed' ? managedRuntime : runtimes.find(runtime => runtime.id === executionId),
    [executionId, runtimes],
  );
  const runtimeKind = executionId === 'managed' ? 'managed' : 'hosted-runtime';
  const labels = capabilityLabels(execution?.capabilities);
  const capabilityDetail = capabilityDetails(execution?.capabilities);
  const canSubmit = !submitting && !!name.trim() && !!agentKey.trim() && !!execution;

  async function handleSubmit() {
    if (!execution) return;
    setErr(null);
    setSubmitting(true);
    try {
      const req: AgentCreateRequest = {
        name: name.trim(), agentKey: agentKey.trim(), tenant: scope.tenant, namespace: scope.namespace,
        runtimeKind,
        runtimeProfileId: runtimeKind === 'hosted-runtime' ? execution.runtimeProfileId : undefined,
        runtimePoolId: runtimeKind === 'hosted-runtime' ? execution.runtimePoolId : undefined,
        description: description.trim() || undefined, model: model.trim() || undefined,
        system: sysPrompt.trim() || undefined,
        workspacePath: runtimeKind === 'managed' ? workspacePath.trim() || undefined : undefined,
        workspaceId: workspaceId || undefined, defaultEnvironmentId: defaultEnvironmentId || undefined,
      };
      const created = await createAgent(req);
      navigate(scope.scopedPath(`/agent-center/agents/${encodeURIComponent(created.id)}`), { replace: true });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="console-page-legacy" style={S.page}>
      <header style={S.header}>
        <div style={S.headerMain}>
          <button type="button" aria-label="返回上一页" title="返回上一页" style={S.back} onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
          <div><h1 style={S.title}>创建 Agent</h1><p style={S.subtitle}>查看并配置</p></div>
        </div>
        <span style={S.headerPill}>{execution?.name ?? '正在检测运行时…'}</span>
      </header>

      <div style={S.content}>
        <section style={S.section}>
          <h2 style={S.sectionTitle}><Bot size={19} /> 身份</h2>
          <p style={S.sectionHint}>给该 Agent 起一个易识别的名称，并写一句简洁的用途说明。</p>
          <div style={S.card}>
            <div style={S.row}>
              <label htmlFor="agent-name" style={S.label}>名称</label>
              <input id="agent-name" style={S.input} value={name} onChange={e => {
                setName(e.target.value);
                if (!agentKeyCustomized) setAgentKey(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''));
              }} placeholder="e.g. Repository reviewer" autoFocus />
            </div>
            <div style={{ ...S.row, ...S.lastRow }}>
              <label htmlFor="agent-description" style={S.label}>描述</label>
              <div>
                <textarea id="agent-description" style={{ ...S.textarea, minHeight: 90, fontFamily: 'inherit' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="这个 Agent 做什么？" maxLength={255} />
                <div style={{ ...S.hint, textAlign: 'right' }}>{description.length} / 255</div>
              </div>
            </div>
          </div>
        </section>

        <section style={S.section}>
          <h2 style={S.sectionTitle}><Sparkles size={19} /> 行为与能力</h2>
          <p style={S.sectionHint}>定义它的工作方式，并挂载它可以依赖的 Workspace 能力。</p>
          <div style={S.card}>
            <div style={S.row}>
              <label htmlFor="agent-instructions" style={S.label}>Instructions</label>
              <div>
                <textarea id="agent-instructions" style={S.textarea} value={sysPrompt} onChange={e => setSysPrompt(e.target.value)} placeholder="写下该 Agent 应该做什么、重点关注什么、避免什么…" />
                <div style={S.hint}>所选运行时适配器会把这些指令映射为其原生的提示词或配置。</div>
              </div>
            </div>
            <div style={{ ...S.row, ...S.lastRow }}>
              <label htmlFor="agent-workspace" style={S.label}>Workspace</label>
              <div>
                <select id="agent-workspace" style={S.input} value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}>
                  <option value="">未关联 Workspace</option>
                  {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
                <div style={S.hint}>Workspace 是仓库指引、技能、工具与 Subagent 的可移植来源。</div>
                {preview && <div style={S.preview}><strong>{preview.name}</strong> · {preview.agentsMdExists ? 'AGENTS.md · ' : ''}{preview.skillCount ?? 0} skills · {preview.subagentCount ?? 0} subagents</div>}
              </div>
            </div>
          </div>
        </section>

        <section style={S.section}>
          <h2 style={S.sectionTitle}><Cpu size={19} /> 执行</h2>
          <p style={S.sectionHint}>选择 Agent 的运行位置。主机、池、Profile 与 CLI 命令都在该选择背后解析。</p>
          <div style={S.card}>
            <div style={S.row}>
              <label htmlFor="agent-runtime" style={S.label}>运行时</label>
              <div>
                <select id="agent-runtime" style={S.input} value={executionId} onChange={e => { setExecutionCustomized(true); setExecutionId(e.target.value); }}>
                  {runtimes.map(runtime => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}
                  <option value="managed">{managedRuntime.name}</option>
                </select>
                {runtimes.length === 0 && <div style={S.hint}>本地没有在线的 Agent 运行时，已选中 AgentScope Managed。</div>}
                {labels.length > 0 && <div style={S.capabilityList}>{labels.map(label => <span key={label} style={S.capability}>{label}</span>)}</div>}
                {capabilityDetail && <div style={S.hint}>{capabilityDetail}</div>}
              </div>
            </div>
            <div style={{ ...S.row, ...S.lastRow }}>
              <label htmlFor="agent-model" style={S.label}>模型</label>
              <div>
                <input id="agent-model" style={S.input} value={model} onChange={e => setModel(e.target.value)} placeholder="默认（服务商）" />
                <div style={S.hint}>Optional override. Leave blank to use the runtime provider's default model.</div>
              </div>
            </div>
          </div>
        </section>

        <details style={S.details}>
          <summary style={S.summary}>高级设置</summary>
          <div style={{ ...S.row, paddingLeft: 0, paddingRight: 0 }}>
            <label htmlFor="agent-key" style={S.label}>Agent key</label>
            <div><input id="agent-key" style={S.input} value={agentKey} onChange={e => { setAgentKeyCustomized(true); setAgentKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')); }} placeholder="repository-reviewer" /><div style={S.hint}>{scope.selectorVisible ? 'Stable identity inside the current tenant and namespace.' : 'Stable identity for this agent.'}</div></div>
          </div>
          {runtimeKind === 'managed' && <div style={{ ...S.row, paddingLeft: 0, paddingRight: 0 }}>
            <label htmlFor="agent-environment" style={S.label}><FolderKanban size={16} /> 环境</label>
            <select id="agent-environment" style={S.input} value={defaultEnvironmentId} onChange={e => setDefaultEnvironmentId(e.target.value)}>
              <option value="">自动（本地默认）</option>
              {environments.map(environment => <option key={environment.id} value={environment.id}>{environment.name} ({environment.type})</option>)}
            </select>
          </div>}
          {runtimeKind === 'managed' && <div style={{ ...S.row, ...S.lastRow, paddingLeft: 0, paddingRight: 0 }}>
            <label htmlFor="agent-workspace-path" style={S.label}><Wrench size={16} /> Workspace 路径</label>
            <input id="agent-workspace-path" style={S.input} value={workspacePath} onChange={e => setWorkspacePath(e.target.value)} placeholder="自动" />
          </div>}
        </details>
      </div>

      <footer style={S.footer}>
        {err && <span style={S.error}>{err}</span>}
        <button style={S.secondary} onClick={() => navigate(scope.scopedPath('/agent-center/agents'))}>取消</button>
        <button style={{ ...S.primary, ...(canSubmit ? {} : S.disabled) }} onClick={handleSubmit} disabled={!canSubmit}>{submitting ? '创建中…' : '创建并打开 Agent'}</button>
      </footer>
    </div>
  );
}

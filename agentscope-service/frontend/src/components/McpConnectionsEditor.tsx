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

import React, { useEffect, useRef, useState } from 'react';
import McpOAuthConnect from './McpOAuthConnect';
import { isGitHubMcp } from '../api/mcpOAuth';
import type { AgentToolset, McpServerSpec, ToolConfigEntry } from '../api/agents';

interface Props {
  servers: McpServerSpec[];
  tools: AgentToolset[];
  readOnly?: boolean;
  canConnect?: boolean;
  onOAuthConnected?: (vaultId: string) => Promise<void>;
  onSave: (servers: McpServerSpec[], tools: AgentToolset[]) => Promise<unknown>;
  catalogDraft?: McpServerSpec;
  onDraftConsumed?: () => void;
}
const field: React.CSSProperties = { padding: 8, border: '1px solid #cbd5e1', borderRadius: 6, width: '100%', boxSizing: 'border-box' };
const button: React.CSSProperties = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const headersExample = JSON.stringify({ Authorization: 'Bearer ${MCP_TOKEN}', 'X-Client': 'agentscope' }, null, 2);
const environmentExample = JSON.stringify({ API_KEY: '${MCP_TOKEN}', LOG_LEVEL: 'info' }, null, 2);
const jsonField: React.CSSProperties = { ...field, fontFamily: 'monospace', resize: 'vertical' };
const example: React.CSSProperties = { margin: '6px 0 16px', padding: 12, borderRadius: 6, background: '#f8fafc', fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export function editorTransport(server: McpServerSpec): string {
  const transport = server.transport ?? (server.url ? 'http' : 'stdio');
  return ['streamable-http', 'streamablehttp'].includes(transport) ? 'http' : transport;
}
const ignoredEnvironment = 'Environment variables are only passed to local stdio processes. This remote connection ignores them. Configure authentication in Headers or attach a Vault with a bearer credential for this connection.';

export default function McpConnectionsEditor({ servers, tools, readOnly, onSave, canConnect, onOAuthConnected, catalogDraft, onDraftConsumed }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const [oauthServer, setOAuthServer] = useState<McpServerSpec>();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<McpServerSpec>({ name: '', transport: 'http', required: true });
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState('always_ask');
  const [entries, setEntries] = useState<ToolConfigEntry[]>([]);
  const [environment, setEnvironment] = useState('{}');
  const [headers, setHeaders] = useState('{}');
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!catalogDraft || readOnly) return;
    edit(catalogDraft);
    setEditing('');
    setEnabled(false);
    onDraftConsumed?.();
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [catalogDraft, readOnly]);

  function edit(server?: McpServerSpec) {
    const toolset = tools.find(t => t.type === 'mcp_toolset' && t.mcpServerName === server?.name);
    setEditing(server?.name ?? '');
    setDraft(server ? { ...server, transport: editorTransport(server) } : { name: '', transport: 'http', required: true, timeout: 'PT30S' });
    setEnabled(server ? toolset?.defaultConfig?.enabled !== false : false);
    setPolicy(toolset?.defaultConfig?.permissionPolicy?.type ?? 'always_ask');
    setEntries(toolset?.configs ?? []);
    setEnvironment(JSON.stringify(server?.env ?? {}, null, 2));
    setHeaders(JSON.stringify(server?.headers ?? {}, null, 2));
    setArgs((server?.args ?? []).join('\n'));
    setError('');
  }
  function stringMap(raw: string): Record<string, string> {
    const result: unknown = JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.values(result).some(v => typeof v !== 'string')) throw new Error('Headers 和环境变量必须是值为字符串的 JSON 对象。');
    return result as Record<string, string>;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(draft.name) || draft.name.includes('__')) throw new Error('连接名称最多使用 64 个字母、数字、连字符或单个下划线。');
      if (servers.some(s => s.name === draft.name && s.name !== editing)) throw new Error('连接名称已存在。');
      if (draft.transport !== 'stdio' && !/^https?:\/\//.test(draft.url ?? '')) throw new Error('Enter an HTTP or HTTPS endpoint.');
      if (draft.transport === 'stdio' && !draft.command?.trim()) throw new Error('请输入命令。');
      if (entries.some(e => !e.name?.trim()) || new Set(entries.map(e => e.name)).size !== entries.length) throw new Error('工具名称不能为空且必须唯一。');
      const server = { ...draft, type: draft.transport === 'stdio' ? 'stdio' : 'url', env: stringMap(environment), headers: stringMap(headers), args: args.split('\n').filter(Boolean) };
      if (server.transport !== 'stdio' && Object.keys(server.env).length > 0) throw new Error(`${ignoredEnvironment} Clear the unused Environment before saving.`);
      const toolset: AgentToolset = { type: 'mcp_toolset', mcpServerName: draft.name, defaultConfig: { enabled, permissionPolicy: { type: policy } }, configs: entries };
      await onSave([...servers.filter(s => s.name !== editing), server], [...tools.filter(t => !(t.type === 'mcp_toolset' && t.mcpServerName === editing)), toolset]);
      setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : '保存连接失败'); }
    finally { setBusy(false); }
  }
  async function remove(name: string) {
    setBusy(true); setError('');
    try { await onSave(servers.filter(s => s.name !== name), tools.filter(t => !(t.type === 'mcp_toolset' && t.mcpServerName === name))); }
    catch (e) { setError(e instanceof Error ? e.message : '移除连接失败'); }
    finally { setBusy(false); }
  }
  return <section ref={sectionRef} aria-label="已配置的 MCP 连接" style={{ padding: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h3>MCP 连接</h3>{!readOnly && <button style={button} disabled={busy} onClick={() => edit()}>添加连接</button>}</div>
    <p style={{ color: '#64748b', fontSize: 13 }}>Configure external tools here. Attach a Vault when starting a session; bearer credentials target the connection name or exact endpoint URL. Connection failures appear in session events.</p>
    {servers.map(server => <div key={server.name} style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'center' }}>
      <span style={{ flex: 1 }}><strong>{server.name}</strong> · {server.transport ?? 'http'} · {server.required === false ? 'optional' : 'required'}<br /><small>{server.url ?? server.command}</small>
        {editorTransport(server) !== 'stdio' && Object.keys(server.env ?? {}).length > 0 && <span role="alert" style={{ display: 'block', color: '#b45309', fontSize: 13 }}>{ignoredEnvironment}</span>}
      </span>
      {(canConnect ?? !readOnly) && server.url?.startsWith('https://') && <button style={button} disabled={busy} onClick={() => setOAuthServer(server)}>{isGitHubMcp(server.url) ? '连接 GitHub' : '连接账号'}</button>}
      {!readOnly && <><button style={button} disabled={busy} onClick={() => edit(server)}>编辑</button><button style={button} disabled={busy} onClick={() => void remove(server.name)}>移除</button></>}
    </div>)}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {editing !== null && !readOnly && <form onSubmit={save} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <label>名称<input style={field} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required /></label>
      <label>传输方式<select style={field} value={draft.transport ?? 'http'} onChange={e => setDraft({ ...draft, transport: e.target.value })}><option value="http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio">stdio（仅本地环境）</option></select></label>
      {draft.transport === 'stdio' ? <><p>需要显式的本地环境。沙箱与自托管环境请使用 HTTP 或 SSE。</p><label>命令<input style={field} value={draft.command ?? ''} onChange={e => setDraft({ ...draft, command: e.target.value })} /></label><label>参数，每行一个<textarea style={field} value={args} onChange={e => setArgs(e.target.value)} /></label></> : <label>Endpoint URL<input style={field} value={draft.url ?? ''} onChange={e => setDraft({ ...draft, url: e.target.value })} /></label>}
      <label>请求超时（ISO 时长）<input style={field} value={draft.timeout ?? 'PT30S'} onChange={e => setDraft({ ...draft, timeout: e.target.value })} placeholder="PT30S" /></label>
      <label><input type="checkbox" checked={draft.required !== false} onChange={e => setDraft({ ...draft, required: e.target.checked })} /> 必需：该连接无法加载时本轮直接失败，下一轮重试</label>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> 默认启用工具，包括服务器后续新增的工具</label>
      <label>默认权限<select style={field} value={policy} onChange={e => setPolicy(e.target.value)}><option value="always_ask">调用前询问</option><option value="always_allow">允许</option><option value="deny">拒绝</option></select></label>
      <div>按工具的覆盖设置（MCP 原始工具名）</div>
      {entries.map((entry, index) => <div key={index} style={{ display: 'flex', gap: 8 }}>
        <input aria-label={`Tool ${index + 1} name`} style={field} value={entry.name} onChange={e => setEntries(entries.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
        <label><input type="checkbox" checked={entry.enabled ?? enabled} onChange={e => setEntries(entries.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item))} />已启用</label>
        <select aria-label={`Tool ${index + 1} permission`} value={entry.permissionPolicy?.type ?? ''} onChange={e => setEntries(entries.map((item, i) => i === index ? { ...item, permissionPolicy: e.target.value ? { type: e.target.value } : undefined } : item))}><option value="">继承</option><option value="always_ask">询问</option><option value="always_allow">允许</option><option value="deny">拒绝</option></select>
        <button style={button} type="button" onClick={() => setEntries(entries.filter((_, i) => i !== index))}>移除</button>
      </div>)}
      <button style={button} type="button" onClick={() => setEntries([...entries, { name: '', enabled: true }])}>添加工具覆盖</button>
      <details>
        <summary>{draft.transport === 'stdio' ? 'Headers 与 stdio 环境变量' : 'Headers 与鉴权'}</summary>
        <p>Both fields accept JSON objects with string values. Use {'{}'} when no configuration is needed.</p>
        <p>To use <code>{'${MCP_TOKEN}'}</code>, create a Vault credential with type <code>environment_variable</code>, target <code>MCP_TOKEN</code>, and your token as its secret. Attach that Vault when starting the session.</p>
        <label>Headers<textarea style={jsonField} rows={4} value={headers} placeholder={headersExample} onChange={e => setHeaders(e.target.value)} /></label>
        <p style={{ color: '#64748b', fontSize: 13, margin: '6px 0' }}>示例：HTTP 或 SSE MCP 服务器的请求头。请按实际服务器替换 header 名称。</p>
        <pre style={example}>{headersExample}</pre>
        {(draft.transport === 'stdio' || environment.trim() !== '{}') && <>
        {draft.transport !== 'stdio' && <p role="alert" style={{ color: '#b45309' }}>{ignoredEnvironment} <button type="button" style={button} onClick={() => setEnvironment('{}')}>清除未使用的环境变量</button></p>}
        <label>环境变量（仅 stdio）<textarea style={jsonField} rows={4} value={environment} placeholder={environmentExample} onChange={e => setEnvironment(e.target.value)} /></label>
        <p style={{ color: '#64748b', fontSize: 13, margin: '6px 0' }}>Example: environment variables passed to the stdio MCP process. Replace variable names to match your command; these do not configure the session Environment resource.</p>
        <pre style={example}>{environmentExample}</pre>
        </>}
      </details>
      <div style={{ display: 'flex', gap: 8 }}><button style={button} type="submit" disabled={busy}>{busy ? '保存中…' : '保存连接'}</button><button style={button} type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button></div>
    </form>}
    {oauthServer && <McpOAuthConnect server={oauthServer} onClose={() => setOAuthServer(undefined)} onConnected={onOAuthConnected} />}
  </section>;
}

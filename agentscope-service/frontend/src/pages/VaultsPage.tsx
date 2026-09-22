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

import { ResourceConsumers } from '../components/ResourceConsumers';
import React, { useEffect, useState } from 'react';
import {
  Vault,
  VaultCredential,
  addCredential,
  archiveVault,
  createVault,
  deleteCredential,
  deleteVault,
  listCredentials,
  listVaults,
  updateCredential,
  updateVault,
  validateCredential,
} from '../api/vaults';

const S: Record<string, React.CSSProperties> = {
  root: { padding: '40px 44px', maxWidth: 1200 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { margin: 0, fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' },
  blurb: { margin: '0 0 24px', color: '#64748b', fontSize: '1rem', lineHeight: 1.6, maxWidth: 760 },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
    color: '#ffffff', border: 'none',
    borderRadius: 10, padding: '11px 20px', fontSize: '0.95rem', fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(99,102,241,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
  },
  card: {
    background: '#ffffff', border: '1px solid #e2e8f0',
    borderRadius: 14, padding: '20px 22px', marginBottom: 18,
    boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
  },
  rowBtn: {
    padding: '7px 14px', fontSize: '0.84rem', fontWeight: 500, borderRadius: 8, cursor: 'pointer',
    border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569',
  },
  danger: { color: '#dc2626', borderColor: '#fca5a5' },
  formField: { display: 'block', fontSize: '0.85rem', color: '#475569', marginBottom: 6, fontWeight: 500 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 8,
    color: '#0f172a', fontSize: '0.92rem',
  },
  err: { color: '#dc2626', fontSize: '0.95rem', marginBottom: 16 },
  notice: {
    padding: '12px 16px', borderRadius: 10, marginBottom: 16,
    background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '0.88rem',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: 600 },
  td: { padding: '10px', borderBottom: '1px solid #f1f5f9', color: '#334155' },
  modal: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  },
  modalBody: {
    background: '#ffffff', borderRadius: 14, padding: '28px 32px',
    width: '100%', maxWidth: 480, boxShadow: '0 20px 50px rgba(15,23,42,0.2)',
  },
};

export default function VaultsPage() {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [selected, setSelected] = useState<Vault | null>(null);
  const [credentials, setCredentials] = useState<VaultCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creatingVault, setCreatingVault] = useState(false);
  const [addingCred, setAddingCred] = useState(false);
  const [vaultName, setVaultName] = useState('');
  const [credType, setCredType] = useState('static_bearer');
  const [credLabel, setCredLabel] = useState('');
  const [credTarget, setCredTarget] = useState('');
  const [credSecret, setCredSecret] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refreshVaults() {
    setLoading(true);
    setErr(null);
    try {
      setVaults(await listVaults());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadCredentials(vault: Vault) {
    setSelected(vault);
    setErr(null);
    try {
      setCredentials(await listCredentials(vault.id));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载凭据失败');
    }
  }

  useEffect(() => { void refreshVaults(); }, []);

  async function handleCreateVault(e: React.FormEvent) {
    e.preventDefault();
    if (!vaultName.trim()) return;
    setBusyId('create');
    try {
      const created = await createVault({ displayName: vaultName.trim() });
      setCreatingVault(false);
      setVaultName('');
      await refreshVaults();
      await loadCredentials(created);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRenameVault(v: Vault) {
    const next = window.prompt('重命名 Vault', v.displayName);
    if (next == null || !next.trim() || next.trim() === v.displayName) return;
    setBusyId(v.id);
    try {
      await updateVault(v.id, { displayName: next.trim() });
      await refreshVaults();
      if (selected?.id === v.id) {
        setSelected({ ...v, displayName: next.trim() });
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '重命名失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleArchiveVault(id: string) {
    if (!confirm('归档该 Vault？之后不会再向 Session 注入凭据。')) return;
    setBusyId(id);
    try {
      await archiveVault(id);
      if (selected?.id === id) { setSelected(null); setCredentials([]); }
      await refreshVaults();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '归档失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteVault(id: string) {
    if (!confirm('删除该 Vault 及其全部凭据？')) return;
    setBusyId(id);
    try {
      await deleteVault(id);
      if (selected?.id === id) { setSelected(null); setCredentials([]); }
      await refreshVaults();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleValidateCredential(credentialId: string) {
    if (!selected) return;
    setBusyId(credentialId);
    try {
      const result = await validateCredential(selected.id, credentialId);
      const detail = Object.entries(result.checks).map(([k, v]) => `${k}=${v}`).join(', ');
      window.alert(result.ok ? `Valid (${detail})` : `Invalid (${detail})`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '校验失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRotateSecret(credentialId: string) {
    if (!selected) return;
    const secret = window.prompt('输入新密钥（只写；不会再次显示）');
    if (secret == null || !secret) return;
    setBusyId(credentialId);
    try {
      await updateCredential(selected.id, credentialId, { secret });
      await loadCredentials(selected);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '更新失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddCredential(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !credLabel.trim() || !credSecret.trim()) return;
    setBusyId('cred');
    try {
      if (!credTarget.trim()) throw new Error('输入连接名、端点 URL 或环境变量名。');
      if (credType === 'environment_variable' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credTarget.trim())) throw new Error('请输入合法的环境变量名。');
      if (credType === 'mcp_oauth') {
        const value = JSON.parse(credSecret);
        if (typeof value.access_token !== 'string' || !value.access_token) throw new Error('OAuth 凭据需要 access_token。');
      }
      await addCredential(selected.id, {
        type: credType,
        label: credLabel.trim(),
        target: credTarget.trim(),
        secret: credSecret,
      });
      setAddingCred(false);
      setCredLabel('');
      setCredTarget('');
      setCredSecret('');
      await loadCredentials(selected);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '添加失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteCredential(credentialId: string) {
    if (!selected || !confirm('删除该凭据？')) return;
    setBusyId(credentialId);
    try {
      await deleteCredential(selected.id, credentialId);
      await loadCredentials(selected);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="console-page-legacy" style={S.root}>
      <div style={S.header}>
        <h1 style={S.title}>Vault</h1>
        <button type="button" style={S.primaryBtn} onClick={() => setCreatingVault(true)}>＋ 新建 Vault</button>
      </div>
      <p style={S.blurb}>
        Manage credentials that Agents can use through their configured Vault bindings. Each credential’s target identifies the connection or environment variable it serves.
      </p>
      <div style={S.notice}>🔒 密钥值为只写 —— 添加后仅显示元数据（类型、标签、目标）。</div>
      {err && <div style={S.err}>{err}</div>}
      {loading && <div style={{ color: '#64748b' }}>加载中…</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
        <div>
          {vaults.map(v => (
            <div
              key={v.id}
              style={{
                ...S.card,
                cursor: 'pointer',
                borderColor: selected?.id === v.id ? '#c7d2fe' : '#e2e8f0',
                background: selected?.id === v.id ? '#eef2ff' : '#ffffff',
              }}
              onClick={() => loadCredentials(v)}
            >
              <div style={{ fontWeight: 600 }}>{v.displayName}</div>
              <div style={{ fontSize: '0.76rem', color: '#94a3b8', fontFamily: 'monospace' }}>{v.id}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={S.rowBtn}
                  onClick={e => { e.stopPropagation(); void handleRenameVault(v); }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  style={S.rowBtn}
                  onClick={e => { e.stopPropagation(); void handleArchiveVault(v.id); }}
                >
                  Archive
                </button>
                <button
                  type="button"
                  style={{ ...S.rowBtn, ...S.danger }}
                  onClick={e => { e.stopPropagation(); void handleDeleteVault(v.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!loading && vaults.length === 0 && (
            <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>暂无 Vault。</div>
          )}
        </div>

        <div>
          {selected ? (
            <div style={S.card}>
              <ResourceConsumers kind="vault" id={selected.id} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{selected.displayName} — credentials</h2>
                <button type="button" style={S.rowBtn} onClick={() => setAddingCred(true)}>＋ 添加凭据</button>
              </div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>标签</th>
                    <th style={S.th}>类型</th>
                    <th style={S.th}>目标</th>
                    <th style={S.th}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.map(c => (
                    <tr key={c.id}>
                      <td style={S.td}>{c.label}</td>
                      <td style={S.td}><code>{c.type}</code></td>
                      <td style={S.td}>{c.target || '—'}</td>
                      <td style={S.td}>
                        <button type="button" style={S.rowBtn} onClick={() => handleValidateCredential(c.id)}>校验</button>
                        {' '}
                        <button type="button" style={S.rowBtn} onClick={() => handleRotateSecret(c.id)}>轮换</button>
                        {' '}
                        <button type="button" style={{ ...S.rowBtn, ...S.danger }} onClick={() => handleDeleteCredential(c.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                  {credentials.length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, color: '#94a3b8', fontStyle: 'italic' }}>该 Vault 中暂无凭据。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', padding: '40px 0', textAlign: 'center' }}>选择一个 Vault 来管理凭据。</div>
          )}
        </div>
      </div>

      {creatingVault && (
        <div style={S.modal} onClick={() => setCreatingVault(false)}>
          <div style={S.modalBody} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 18px', fontSize: '1.2rem' }}>新建 Vault</h2>
            <form onSubmit={handleCreateVault}>
              <label style={S.formField}>显示名称</label>
              <input style={{ ...S.input, marginBottom: 20 }} value={vaultName} onChange={e => setVaultName(e.target.value)} autoFocus />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" style={S.rowBtn} onClick={() => setCreatingVault(false)}>取消</button>
                <button type="submit" style={S.primaryBtn} disabled={busyId === 'create'}>创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addingCred && selected && (
        <div style={S.modal} onClick={() => setAddingCred(false)}>
          <div style={S.modalBody} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 18px', fontSize: '1.2rem' }}>添加凭据</h2>
            <form onSubmit={handleAddCredential}>
              <label style={S.formField}>类型</label>
              <select style={{ ...S.input, marginBottom: 14 }} value={credType} onChange={e => setCredType(e.target.value)}>
                <option value="static_bearer">MCP Bearer 令牌</option>
                <option value="mcp_oauth">MCP OAuth Token（可选刷新）</option>
                <option value="environment_variable">显式环境变量占位符</option>
                <option value="api_key">通用密钥（仅存储）</option>
              </select>
              <label style={S.formField}>标签</label>
              <input style={{ ...S.input, marginBottom: 14 }} value={credLabel} onChange={e => setCredLabel(e.target.value)} autoFocus />
              <label style={S.formField}>目标</label>
              <input style={{ ...S.input, marginBottom: 14 }} value={credTarget} onChange={e => setCredTarget(e.target.value)} placeholder={credType === 'environment_variable' ? 'CRM_TOKEN' : 'crm 或 https://crm.example/mcp'} />
              <p style={{ fontSize: 12, color: '#64748b' }}>{credType === 'environment_variable' ? '只有被显式引用的 ${VARIABLE} 值才会替换进 MCP 的 headers、环境变量或查询参数。' : 'Bearer 与 OAuth 凭据会匹配连接名或其完整端点 URL（含路径）。'}</p>
              {credType === 'mcp_oauth' && <p style={{ fontSize: 12, color: '#64748b' }}>输入 JSON，包含 access_token 与可选的 expires_at。自动续期还需要 refresh.token_endpoint、client_id 和 refresh_token。客户端鉴权可在 refresh.token_endpoint_auth 下配置。刷新用的凭据保留在控制面。</p>}
              <label style={S.formField}>密钥（只写）</label>
              <input style={{ ...S.input, marginBottom: 20 }} type="password" value={credSecret} onChange={e => setCredSecret(e.target.value)} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" style={S.rowBtn} onClick={() => setAddingCred(false)}>取消</button>
                <button type="submit" style={S.primaryBtn} disabled={busyId === 'cred'}>添加</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

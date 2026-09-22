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

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePassword, getProfile, listLoginSessions, revokeLoginSession, revokeOtherLoginSessions, updateProfile } from '@/api/auth';
import { getMyPreferences, setDefaultNamespace } from '@/api/permissions';
import { api } from '@/lib/apiClient';
import { useControlPlaneScope } from '@/app/ScopeContext';
import { namespaceCan } from '@/lib/namespaceScope';
import { Page, PageHeader } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice, RoleBadges, RoleGuide } from '@/features/settings/AccessComponents';

type IMIdentity = { channelId: string; platform: string; accountId: string; senderId: string };
type Connections = { identities: IMIdentity[]; subscriptions: { id: string; channelId: string; platform: string; issueId: string }[] };

export default function ProfilePage() {
  const scope = useControlPlaneScope(); const qc = useQueryClient(); const navigate = useNavigate();
  const [tab, setTab] = useState('account'); const [displayName, setDisplayName] = useState('');
  const [current, setCurrent] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [defaultSpace, setDefaultSpace] = useState(''); const [notice, setNotice] = useState('');
  const profile = useQuery({ queryKey: ['my-profile'], queryFn: getProfile });
  const preferences = useQuery({ queryKey: ['my-preferences'], queryFn: getMyPreferences });
  const sessions = useQuery({ queryKey: ['my-login-sessions'], queryFn: listLoginSessions, enabled: tab === 'security' });
  const connections = useQuery({ queryKey: ['my-channel-connections'], queryFn: () => api.get<Connections>('/api/user/channel-connections'), enabled: tab === 'connections' });
  useEffect(() => { if (profile.data) setDisplayName(profile.data.displayName || ''); }, [profile.data]);
  useEffect(() => { if (preferences.data) setDefaultSpace(preferences.data.preferences.defaultNamespace || ''); }, [preferences.data]);
  const saveProfile = useMutation({ mutationFn: () => updateProfile(displayName.trim()), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['my-profile'] }); setNotice('个人资料已保存。'); } });
  const saveDefault = useMutation({ mutationFn: () => setDefaultNamespace(defaultSpace), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['my-preferences'] }); scope.refreshNamespaces(); setNotice('默认空间已保存。在最近选择或显式选择都不可用时使用它。'); } });
  const change = useMutation({ mutationFn: () => changePassword(current, password), onSuccess: () => { setCurrent(''); setPassword(''); setConfirm(''); setNotice('Password updated. Other login sessions have been revoked.'); void qc.invalidateQueries({ queryKey: ['my-login-sessions'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => id === 'others' ? revokeOtherLoginSessions() : revokeLoginSession(id), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-login-sessions'] }); setNotice('登录访问已吊销。'); } });
  const disconnect = useMutation({ mutationFn: (value: IMIdentity | string) => typeof value === 'string' ? api.delete(`/api/user/channel-subscriptions/${encodeURIComponent(value)}`) : api.delete('/api/user/channel-connections', value), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-channel-connections'] }); setNotice('连接偏好已更新。'); } });
  const tabs = ['account', 'my namespaces', 'security', 'connections'];
  return <Page className="max-w-5xl"><PageHeader title="个人资料" description="管理你的身份、空间偏好、账号安全与 IM 连接。" /><nav aria-label="个人资料设置" className="flex gap-5 overflow-x-auto border-b">{tabs.map(t => <button key={t} onClick={() => { setTab(t); setNotice(''); }} className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium capitalize ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>{t}</button>)}</nav>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <ErrorNotice error={profile.error || saveProfile.error || saveDefault.error || change.error || revoke.error || disconnect.error} />
    {tab === 'account' && <section className="space-y-5 rounded-xl border p-5"><h2 className="text-lg font-semibold">账号</h2>{profile.data ? <><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">用户名</dt><dd className="mt-1 font-medium">{profile.data.username}</dd></div><div><dt className="text-slate-500">账号 ID</dt><dd className="mt-1 break-all font-mono text-xs">{profile.data.userId}</dd></div><div><dt className="text-slate-500">平台访问权限</dt><dd className="mt-1"><Badge>{profile.data.roles.includes('admin') ? '平台管理员' : '控制台用户'}</Badge></dd></div></dl><form className="space-y-4 border-t pt-4" onSubmit={e => { e.preventDefault(); saveProfile.mutate(); }}><label className="block max-w-md space-y-2 text-sm font-medium">显示名称<Input maxLength={100} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={profile.data.username} /></label><Button type="submit" disabled={saveProfile.isPending}>保存个人资料</Button></form></> : <p className="text-sm text-slate-500">正在加载账号…</p>}</section>}
    {tab === 'my namespaces' && <div className="space-y-5"><section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">默认空间</h2><ErrorNotice error={preferences.error} /><select aria-label="Default namespace" className="h-10 w-full max-w-md rounded-lg border bg-white px-3 text-sm" value={defaultSpace} onChange={e => setDefaultSpace(e.target.value)}><option value="">系统默认（Default）</option>{scope.namespaces.map(n => <option key={n.name} value={n.name}>{n.displayName}</option>)}</select><div><Button disabled={saveDefault.isPending || preferences.isLoading || !!preferences.error} onClick={() => saveDefault.mutate()}>保存默认设置</Button></div></section><section className="space-y-4"><h2 className="text-lg font-semibold">我的空间</h2>{scope.namespaces.map(n => <article key={n.name} className="space-y-3 rounded-xl border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{n.displayName} <span className="font-normal text-slate-400">{n.name}</span></h3><Button variant="outline" size="sm" onClick={() => { scope.setScope(n.tenant, n.name); navigate(`/work/overview?tenant=${encodeURIComponent(n.tenant)}&namespace=${encodeURIComponent(n.name)}`); }}>打开空间</Button></div><RoleBadges roles={n.roles} />{n.groups && n.groups.length > 0 && <p className="text-sm text-slate-500">User groups: {n.groups.join(', ')}</p>}<p className="text-sm text-slate-500">{namespaceCan(n.roles, 'configure') ? '你可以配置资源并运行工作。' : namespaceCan(n.roles, 'write') ? '你可以使用可用资源创建并运行工作。' : namespaceCan(n.roles, 'operate') ? '你可以运维空间的基础设施。' : '你可以读取共享给你的内容。'} {namespaceCan(n.roles, 'audit') ? '审计员访问权限包含私密业务工作。' : '私密工作需要显式授权才能访问。'}</p><Link className="text-sm text-indigo-600" to={`/settings/namespaces/${encodeURIComponent(n.name)}`}>{namespaceCan(n.roles, 'manage') ? '管理成员、用户组与资源' : '查看资源访问权限与申请'}</Link></article>)}</section><details className="rounded-xl border p-5"><summary className="cursor-pointer text-sm font-medium">了解空间角色</summary><div className="mt-4"><RoleGuide /></div></details></div>}
    {tab === 'security' && <div className="space-y-5"><section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">修改密码</h2><form className="max-w-lg space-y-4" onSubmit={e => { e.preventDefault(); if (password === confirm) change.mutate(); }}><label className="block space-y-2 text-sm">当前密码<Input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></label><label className="block space-y-2 text-sm">新密码<Input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label className="block space-y-2 text-sm">确认密码<Input type="password" required autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>{confirm && password !== confirm && <p className="text-sm text-red-600">两次输入的密码不一致。</p>}<Button type="submit" disabled={change.isPending || !current || password.length < 6 || password !== confirm}>更新密码</Button></form></section><section className="space-y-4 rounded-xl border p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">登录会话</h2><Button variant="outline" disabled={revoke.isPending || !sessions.data?.items.some(s => !s.current)} onClick={() => revoke.mutate('others')}>退出其他会话</Button></div><ErrorNotice error={sessions.error} />{sessions.isLoading && <p className="text-sm text-slate-500">正在加载会话…</p>}{sessions.data?.items.map(s => <div key={s.id} className="flex items-start justify-between gap-4 border-t pt-4"><div className="min-w-0"><p className="break-words text-sm">{s.userAgent || '已有登录'} {s.current && <Badge tone="info">当前会话</Badge>}</p><p className="mt-2 text-xs text-slate-500">Last active {new Date(s.lastSeenAt).toLocaleString()} · Expires {new Date(s.expiresAt).toLocaleString()}</p></div>{!s.current && <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>退出登录</Button>}</div>)}</section></div>}
    {tab === 'connections' && <div className="space-y-5"><ErrorNotice error={connections.error} />{connections.isLoading && <p className="text-sm text-slate-500">正在加载连接…</p>}<section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">我的 IM 身份</h2><p className="text-sm text-slate-500">这些身份把你的 IM 消息与账号关联起来。请在对应的 Channel 页面配对新的身份。</p>{connections.data?.identities.map(i => <div key={`${i.channelId}/${i.accountId}/${i.senderId}`} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div><p className="text-sm font-medium">{i.platform} · {i.channelId}</p><p className="mt-1 break-all text-xs text-slate-500">{i.senderId}</p></div><Button variant="outline" size="sm" disabled={disconnect.isPending} onClick={() => disconnect.mutate(i)}>解除身份关联</Button></div>)}{connections.data?.identities.length === 0 && <p className="text-sm text-slate-500">未关联 IM 身份。</p>}</section><section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">工作通知</h2><p className="text-sm text-slate-500">管理推送到 IM 的 Issue 通知。取消订阅后该订阅不再发送后续事件通知。</p>{connections.data?.subscriptions.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div><p className="text-sm font-medium">{s.platform} · {s.channelId}</p><p className="mt-1 break-all text-xs text-slate-500">Issue {s.issueId}</p></div><Button variant="outline" size="sm" disabled={disconnect.isPending} onClick={() => disconnect.mutate(s.id)}>取消订阅</Button></div>)}{connections.data?.subscriptions.length === 0 && <p className="text-sm text-slate-500">没有生效中的 IM 通知订阅。</p>}</section></div>}
  </Page>;
}

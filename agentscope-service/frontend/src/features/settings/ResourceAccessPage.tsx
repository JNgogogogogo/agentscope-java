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

import { useControlPlaneScope } from '@/app/ScopeContext';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getResourceAccess, listResources, resourceActions, resourceURL, requestResourceAccess, saveResourceAccess, type ResourcePolicy } from '@/api/resourceAccess';
import { searchAccounts, listManagedNamespaces } from '@/api/permissions';
import { Page, PageHeader } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice, AccountPicker, accountLabel } from './AccessComponents';

const descriptions: Record<string, string> = { discover: '查找该资源', use: '运行或挂载该资源', inspect: '读取配置或内容', edit: '修改配置或内容', publish: '发布版本或共享模板', manage: '修改资源权限' };
export default function ResourceAccessPage() {
  const { namespaceName = '', kind = '', resourceId = '' } = useParams(); const qc = useQueryClient(); const scope = useControlPlaneScope();
  const query = useQuery({ queryKey: ['resource-access', namespaceName, kind, resourceId], queryFn: () => getResourceAccess(namespaceName, kind, resourceId) });
  const [policy, setPolicy] = useState<ResourcePolicy>(); const [user, setUser] = useState(''); const [group, setGroup] = useState(''); const [notice, setNotice] = useState('');
  const [action, setAction] = useState('use'); const [reason, setReason] = useState('');
  useEffect(() => { setPolicy(query.data?.policy); }, [query.data]);
  const catalog = useQuery({ queryKey: ['resource-catalog', namespaceName], queryFn: () => listResources(namespaceName) });
  const spaces = useQuery({ queryKey: ['managed-namespaces'], queryFn: listManagedNamespaces, enabled: !!query.data?.canManage && kind === 'workflow' });
  const ids = Object.keys(policy?.users || {});
  const accounts = useQuery({ queryKey: ['resource-accounts', namespaceName, ids], queryFn: () => searchAccounts(namespaceName, '', ids), enabled: ids.length > 0 && !!query.data?.canManage });
  const save = useMutation({ mutationFn: () => saveResourceAccess(namespaceName, kind, resourceId, query.data!.version, policy!), onSuccess: () => { setNotice('资源权限已保存。'); scope.refreshNamespaces(); void qc.invalidateQueries({ queryKey: ['namespace-detail'] }); void qc.invalidateQueries({ queryKey: ['resource-access'] }); void qc.invalidateQueries({ queryKey: ['resource-catalog'] }); void qc.invalidateQueries({ queryKey: ['namespace-audit'] }); } });
  const request = useMutation({ mutationFn: () => requestResourceAccess(namespaceName, query.data!.version, `${kind}:${resourceId}`, action, reason), onSuccess: () => { setReason(''); setNotice('Access request submitted.'); void qc.invalidateQueries({ queryKey: ['access-requests'] }); void qc.invalidateQueries({ queryKey: ['resource-access'] }); } });
  const resource = query.data?.resource;
  const nameFor = (key: string) => catalog.data?.items.find(x => `${x.resource.kind}:${x.resource.id}` === key)?.resource.name || key;
  const toggle = (section: 'users' | 'groups', id: string, action: string, checked: boolean) => { if (!policy) return; const current = policy[section]?.[id] || []; setPolicy({ ...policy, [section]: { ...policy[section], [id]: checked ? [...current, action] : current.filter(a => a !== action) } }); };
  return <Page><Link className="text-sm text-indigo-600" to={`/settings/namespaces/${encodeURIComponent(namespaceName)}?tab=resources`}>← Namespace resources</Link><PageHeader title={resource?.name || '资源访问权限'} description={`${namespaceName} · ${kind}`} />
    <ErrorNotice error={query.error || save.error || request.error} />{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {query.isLoading && <p>正在加载权限…</p>}
    {query.data && <>
      <section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">你的实际权限</h2><div className="grid gap-3 md:grid-cols-2">{query.data.decisions.map(d => <div key={d.action} className="rounded-lg bg-slate-50 p-3"><p className="text-sm font-medium"><span className={d.allowed ? 'text-emerald-700' : 'text-slate-500'}>{d.allowed ? '已允许' : '未授权'}</span> · {d.action}</p><p className="mt-1 text-xs text-slate-500">{d.reason}</p></div>)}</div></section>
      <ErrorNotice error={query.data.dependencyError} />
      {resource?.dependencies && <section className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">依赖项</h2><p className="text-sm text-slate-500">某个依赖项要求你本人具备使用权限或获得批准，该资源才能代你使用它。</p>{resource.dependencies.map(key => { const [k, ...parts] = key.split(':'); return <Link key={key} className="block text-sm text-indigo-600" to={resourceURL(namespaceName, k, parts.join(':'))}>{nameFor(key)} <span className="text-slate-400">{k}</span></Link>; })}{resource.dependencies.length === 0 && <p className="text-sm text-slate-500">未配置依赖项。</p>}</section>}
      {query.data.canManage && policy && <section className="space-y-5 rounded-xl border p-5"><h2 className="font-semibold">资源授权</h2>
        <label className="block space-y-2 text-sm">访问策略<select aria-label="Access policy" className="block h-10 w-full max-w-md rounded-lg border px-3" value={policy.mode} onChange={e => setPolicy({ ...policy, mode: e.target.value as ResourcePolicy['mode'] })}><option value="inherit">继承空间角色，外加显式授权</option><option value="restricted">仅显式资源授权</option></select></label>
        <p className="text-xs text-slate-500">Namespace membership is always required. Namespace administrators retain permission to manage grants. Resource grants do not change private Issue sharing.</p>
        {(['users', 'groups'] as const).map(section => <div key={section} className="space-y-3"><h3 className="text-sm font-semibold capitalize">{section}</h3>{Object.entries(policy[section] || {}).map(([id, actions]) => <div key={id} className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{section === 'groups' ? query.data?.groups?.[id]?.name || id : (() => { const a = accounts.data?.items.find(a => a.userId === id); return a ? accountLabel(a) : id; })()}</span><Button type="button" variant="ghost" size="sm" onClick={() => { const next = { ...policy[section] }; delete next[id]; setPolicy({ ...policy, [section]: next }); }}>移除授权</Button></div><div className="flex flex-wrap gap-4">{resourceActions.map(a => <label key={a} title={descriptions[a]} className="flex items-center gap-2 text-xs"><input aria-label={`${id} ${a}`} type="checkbox" checked={actions.includes(a)} onChange={e => toggle(section, id, a, e.target.checked)} />{a}</label>)}</div></div>)}</div>)}
        <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><AccountPicker namespace={namespaceName} value={user} onChange={setUser} label="授予成员访问权限" exclude={ids} /><Button type="button" variant="outline" disabled={!user} onClick={() => { setPolicy({ ...policy, users: { ...policy.users, [user]: ['discover', 'use'] } }); setUser(''); }}>添加用户授权</Button></div><div className="space-y-2"><select aria-label="授予用户组访问权限" className="h-10 w-full rounded-lg border px-3 text-sm" value={group} onChange={e => setGroup(e.target.value)}><option value="">选择用户组</option>{Object.entries(query.data.groups || {}).filter(([id]) => !policy.groups?.[id]).map(([id, g]) => <option key={id} value={id}>{g.name}</option>)}</select><Button type="button" variant="outline" disabled={!group} onClick={() => { setPolicy({ ...policy, groups: { ...policy.groups, [group]: ['discover', 'use'] } }); setGroup(''); }}>添加用户组授权</Button></div></div>
        <div className="space-y-3 border-t pt-4"><h3 className="font-semibold">允许使用该依赖项的资源</h3><p className="text-sm text-slate-500">Approval applies only through the selected resource. Its callers cannot read this dependency's configuration or credentials.</p>{query.data.dependents?.map(r => { const key = `${r.kind}:${r.id}`; return <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Allow ${r.name} as consumer`} checked={policy.consumers?.includes(key) || false} onChange={e => setPolicy({ ...policy, consumers: e.target.checked ? [...policy.consumers || [], key] : policy.consumers?.filter(k => k !== key) })} />{r.name}<Badge>{r.kind}</Badge></label>; })}{query.data.dependents?.length === 0 && <p className="text-sm text-slate-500">当前没有资源引用该依赖项。</p>}</div>
        {kind === 'workflow' && <div className="space-y-3 border-t pt-4"><h3 className="font-semibold">共享已发布的 Workflow 模板</h3><p className="text-sm text-slate-500">Selected namespaces can import published revisions. They choose their own execution resources; runtime credentials and bindings are not copied.</p>{spaces.data?.items.filter(n => n.name !== namespaceName && !n.archived).map(n => <label key={n.name} className="flex items-center gap-2 text-sm"><input aria-label={`Share template with ${n.displayName}`} type="checkbox" checked={policy.exportTo?.includes(n.name) || false} onChange={e => setPolicy({ ...policy, exportTo: e.target.checked ? [...policy.exportTo || [], n.name] : policy.exportTo?.filter(id => id !== n.name) })} />{n.displayName}</label>)}<ErrorNotice error={spaces.error} /></div>}
        <Button disabled={save.isPending || [...Object.values(policy.users || {}), ...Object.values(policy.groups || {})].some(a => !a.length)} onClick={() => save.mutate()}>保存资源权限</Button>
      </section>}
      <section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">申请额外访问权限</h2><select aria-label="申请的权限" className="h-10 rounded-lg border px-3 text-sm" value={action} onChange={e => setAction(e.target.value)}>{resourceActions.map(a => <option key={a} value={a}>{a} — {descriptions[a]}</option>)}</select><Input aria-label="访问申请理由" placeholder="说明你需要该资源的用途" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /><Button disabled={reason.trim().length < 3 || request.isPending} onClick={() => request.mutate()}>申请访问权限</Button></section>
    </>}
  </Page>;
}

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

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, ShieldCheck, X } from "lucide-react";
import { decideApproval, getApproval } from "@/api/collaboration";
import { useControlPlaneScope } from "@/app/ScopeContext";
import { EntityIdentityText, useEntityIdentities } from "@/components/EntityIdentity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { WorkEmpty, WorkLoadingRows, WorkStatusBadge } from "@/features/work/WorkSurface";
import { managedToolApprovalExpiry, managedToolApprovalRequest } from "./managedToolApproval";

export default function ApprovalDetail({ approvalId, note, onNoteChange, onReady }: { approvalId: string; note: string; onNoteChange: (note: string) => void; onReady: () => void }) {
  const scope = useControlPlaneScope();
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const approval = useQuery({ queryKey: ["approval", scope.tenant, scope.namespace, approvalId], queryFn: () => getApproval(approvalId), refetchInterval: 5000 });
  const item = approval.data?.approval;
  const request = managedToolApprovalRequest(item?.request);
  const expiresAt = managedToolApprovalExpiry(request);
  const expired = expiresAt != null && expiresAt <= now;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (approval.isSuccess) onReady(); }, [approval.isSuccess, onReady]);
  const identities = useEntityIdentities(item ? [
    { type: item.targetType, ref: item.targetRef },
    { type: item.requestedBy.type, ref: item.requestedBy.ref },
    { type: "human", ref: item.approverRef },
  ] : []);
  const decide = useMutation({
    mutationFn: (status: "approved" | "rejected") => decideApproval(approvalId, status, item!.version, { note }),
    onSuccess: (data) => {
      qc.setQueryData(["approval", scope.tenant, scope.namespace, approvalId], data);
      onNoteChange("");
      for (const key of ["approval", "approvals", "inbox", "inbox-item", "inbox-summary", "issue", "issues", "tasks", "issue-runs"]) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: () => void approval.refetch(),
  });
  if (approval.isPending) return <WorkLoadingRows />;
  if (approval.isError || !item) return <WorkEmpty title="审批不可用" description="无法加载该请求。你的消息未被标记为已读。" action={<Button variant="outline" onClick={() => void approval.refetch()}>重试</Button>} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-amber-50 p-3 text-amber-700"><ShieldCheck className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-amber-700">审批</span><WorkStatusBadge status={item.status} /></div>
          <h2 className="mt-2 break-words text-xl font-semibold text-slate-900">{request ? `Confirm tool: ${request.toolName}` : <EntityIdentityText identities={identities} type={item.targetType} entityRef={item.targetRef} />}</h2>
          <p className="mt-1 text-xs text-slate-500">Requested {new Date(item.createdAt).toLocaleString()}</p>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.reason || "继续该操作前需要审批。"}</p>
      <dl className="grid grid-cols-[7rem_1fr] gap-3 rounded-xl border border-slate-200 p-4 text-sm">
        <dt className="text-slate-500">申请人</dt><dd><EntityIdentityText identities={identities} type={item.requestedBy.type} entityRef={item.requestedBy.ref} /></dd>
        <dt className="text-slate-500">审批人</dt><dd><EntityIdentityText identities={identities} type="human" entityRef={item.approverRef} /></dd>
        <dt className="text-slate-500">目标</dt><dd className="break-all"><EntityIdentityText identities={identities} type={item.targetType} entityRef={item.targetRef} /></dd>
        {expiresAt != null && <><dt className="text-slate-500">过期时间</dt><dd className={expired ? "text-red-700" : "text-amber-700"}>{new Date(expiresAt).toLocaleString()}{expired && " · Expired"}</dd></>}
      </dl>
      <div className="flex flex-wrap gap-4 text-sm font-medium text-indigo-600">
        {item.issueId && <Link to={scope.scopedPath(`/work/issues/${item.issueId}`)}>关联 Issue ↗</Link>}
        {item.runId && <Link to={scope.scopedPath(`/work/executions/${item.runId}`)}>执行 ↗</Link>}
        {request && <Link to={scope.scopedPath(`/work/executions/tasks/${request.agentTaskId}`)}>Agent 任务 ↗</Link>}
        {request?.sessionRef && <Link to={scope.scopedPath(`/work/sessions/${request.sessionRef}`)}>Session ↗</Link>}
      </div>
      {request?.inputPreview != null && <div><h3 className="mb-2 text-sm font-semibold">工具输入（已脱敏）</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-50 p-4 text-xs leading-6">{JSON.stringify(request.inputPreview, null, 2)}</pre></div>}
      {item.request != null && <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-medium">请求详情</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs leading-6">{JSON.stringify(item.request, null, 2)}</pre></details>}
      {item.status === "pending" ? <div className="space-y-3 border-t border-slate-200 pt-5">
        <label className="block text-sm font-medium" htmlFor="approval-note">决策备注</label>
        <Textarea id="approval-note" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="添加决策备注（可选）" disabled={decide.isPending || expired} />
        {expired && <p className="text-sm text-amber-800">该请求已过期，无法再审批。执行状态会自动更新。</p>}
        <div className="flex gap-2"><Button disabled={decide.isPending || expired} onClick={() => decide.mutate("approved")}><Check className="h-4 w-4" />通过</Button><Button variant="outline" disabled={decide.isPending || expired} onClick={() => decide.mutate("rejected")}><X className="h-4 w-4" />驳回</Button></div>
      </div> : <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-medium">This request is {item.status}.</p>{item.decision != null && <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">{JSON.stringify(item.decision, null, 2)}</pre>}</div>}
      {decide.isError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">决策保存失败。请求已刷新，请查看其当前状态后重试。</p>}
    </div>
  );
}

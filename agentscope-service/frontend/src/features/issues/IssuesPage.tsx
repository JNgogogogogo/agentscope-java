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

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleDotDashed, Plus, Search } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { createIssue, listIssues, listTeams, type Issue } from "@/api/collaboration";
import { listDefinitions } from "@/api/orchestration";
import { useControlPlaneScope } from "@/app/ScopeContext";
import { AgentPicker } from "@/components/AgentPicker";
import { EntityIdentityText, type EntityIdentityMap, useEntityIdentities } from "@/components/EntityIdentity";
import { NamedResourcePicker } from "@/components/NamedResourcePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import {
  WorkEmpty,
  WorkLoadingRows,
  WorkPage,
  WorkPageHeader,
  WorkPanel,
  WorkStatusBadge,
} from "@/features/work/WorkSurface";
import { filtersForIssueSource, issueSourceFromParam } from "@/features/issues/issueSource";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type IssueView = "all" | "active" | "review" | "done" | "archived";

const issueViews: Array<{ value: IssueView; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "活跃" },
  { value: "review", label: "待评审" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已归档" },
];

function IssueOwnerOrTarget({ issue, identities }: { issue: Issue; identities: EntityIdentityMap }) {
  if (issue.assigneeRef) {
    return <EntityIdentityText identities={identities} type={issue.assigneeType} entityRef={issue.assigneeRef} />;
  }
  if (issue.executionTargetRef) {
    return <EntityIdentityText identities={identities} type={issue.executionTargetType} entityRef={issue.executionTargetRef} secondary />;
  }
  return <span className="text-slate-400">未分配</span>;
}

function priorityTone(priority: string): "default" | "warning" | "danger" {
  if (["urgent", "critical"].includes(priority)) return "danger";
  if (priority === "high") return "warning";
  return "default";
}

export default function IssuesPage() {
  const scope = useControlPlaneScope();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const [title, setTitle] = useState(() => urlParams.get("title") ?? "");
  const [description, setDescription] = useState(() => urlParams.get("description") ?? "");
  const [priority, setPriority] = useState("normal");
  const [accessMode, setAccessMode] = useState<"private" | "namespace">("private");
  const [assigneeRef, setAssigneeRef] = useState("");
  const [assigneeType, setAssigneeType] = useState("agent");
  const [search, setSearch] = useState("");
  const requestedView = urlParams.get("status");
  const view: IssueView = issueViews.some((item) => item.value === requestedView) ? requestedView as IssueView : "all";
  const dialogOpen = urlParams.get("new") === "1";
  const source = issueSourceFromParam(urlParams.get("source"));
  const sourceFilters = filtersForIssueSource(source);
  const archived = view === "archived";
  const issues = useQuery({
    queryKey: ["issues", scope.tenant, scope.namespace, search, archived, source],
    queryFn: () => listIssues(scope.tenant, scope.namespace, "", search, archived, sourceFilters),
    refetchInterval: 7500,
  });
  const teams = useQuery({
    queryKey: ["issue-owner-teams", scope.tenant, scope.namespace],
    queryFn: () => listTeams(scope.tenant, scope.namespace),
    enabled: dialogOpen && assigneeType === "team",
    staleTime: 10_000,
  });
  const workflows = useQuery({
    queryKey: ["issue-owner-workflows", scope.tenant, scope.namespace],
    queryFn: () => listDefinitions(scope.tenant, scope.namespace),
    enabled: dialogOpen && assigneeType === "workflow",
    staleTime: 10_000,
  });
  const teamOptions = useMemo(() => (teams.data?.items ?? [])
    .filter(team => team.status === "active")
    .map(team => ({ id: team.id, label: team.name, secondary: "Team" })), [teams.data?.items]);
  const workflowOptions = useMemo(() => (workflows.data?.definitions ?? [])
    .filter(workflow => !workflow.archivedAt)
    .map(workflow => ({ id: workflow.id, label: workflow.name, secondary: "Workflow" })), [workflows.data?.definitions]);
  const create = useMutation({
    mutationFn: () => createIssue({
      tenant: scope.tenant,
      namespace: scope.namespace,
      access: { mode: accessMode },
      title: title.trim(),
      description: description.trim(),
      priority,
      assigneeType: assigneeRef && assigneeType !== "workflow" ? assigneeType : undefined,
      assigneeRef: assigneeRef && assigneeType !== "workflow" ? assigneeRef : undefined,
      executionTargetType: assigneeRef && assigneeType === "workflow" ? "workflow" : undefined,
      executionTargetRef: assigneeRef && assigneeType === "workflow" ? assigneeRef : undefined,
      sourceType: urlParams.get("fromChat") ? "chat" : undefined,
      sourceRef: urlParams.get("fromChat") || undefined,
      contextRefs: urlParams.get("fromChat") ? { chatId: urlParams.get("fromChat") } : undefined,
    }),
    onSuccess: (data) => {
      setTitle("");
      setDescription("");
      setPriority("normal");
      setAssigneeRef("");
      void qc.invalidateQueries({ queryKey: ["issues"] });
      navigate(scope.scopedPath(`/work/issues/${data.issue.id}`));
    },
  });

  const items = useMemo(() => {
    const rows = issues.data?.items || [];
    if (view === "active") return rows.filter((item) => !["done", "cancelled"].includes(item.status));
    if (view === "review") return rows.filter((item) => item.status === "in_review");
    if (view === "done") return rows.filter((item) => item.status === "done");
    return rows;
  }, [issues.data?.items, view]);
  const identities = useEntityIdentities(items.flatMap((item) => [
    { type: item.assigneeType, ref: item.assigneeRef },
    { type: item.executionTargetType, ref: item.executionTargetRef },
  ]));

  function setParam(name: string, value?: string) {
    const next = new URLSearchParams(urlParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setUrlParams(next, { replace: true });
  }

  function closeCreate() {
    const next = new URLSearchParams(urlParams);
    ["new", "fromChat", "title", "description"].forEach((name) => next.delete(name));
    setUrlParams(next, { replace: true });
    setTitle("");
    setDescription("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim()) create.mutate();
  }

  const emptyDescription = source === "endpoint_jobs"
    ? "该作用域中还没有 Endpoint 任务创建过运维 Issue。"
    : search
      ? "换个搜索词，或清除当前筛选条件。"
      : view === "archived"
        ? "已归档的 Issue 会保留在此处供查阅。"
        : "在该作用域中创建第一个持久化工作项。";

  return (
    <WorkPage>
      <WorkPageHeader
        title="Issue"
        description="规划工作、让讨论留在上下文中，并跟踪每次执行直到评审。"
        actions={
          <Button onClick={() => setParam("new", "1")}>
            <Plus className="h-4 w-4" /> New issue
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1">
          {issueViews.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setParam("status", item.value === "all" ? undefined : item.value)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition",
                view === item.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9 shadow-none"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 Issue"
            />
          </label>
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-ring"
            aria-label="Issue source"
            value={source}
            onChange={(event) => setParam("source", event.target.value === "all" ? undefined : event.target.value)}
          >
            <option value="all">全部来源</option>
            <option value="work">Work Hub</option>
            <option value="endpoint_jobs">Endpoint 任务</option>
          </select>
        </div>
      </div>

      <WorkPanel>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>{issues.isLoading ? "正在加载 Issue…" : `${items.length} issue${items.length === 1 ? "" : "s"}`}</span>
          <span className="hidden sm:block">Updated automatically</span>
        </div>
        {issues.isLoading ? (
          <WorkLoadingRows rows={6} />
        ) : issues.isError ? (
          <WorkEmpty title="Issue 加载失败" description="请检查控制面连接后重试。" />
        ) : !items.length ? (
          <WorkEmpty
            title={search ? "没有匹配的 Issue" : "暂无 Issue"}
            description={emptyDescription}
            action={!search && source !== "endpoint_jobs" && view !== "archived" ? (
              <Button size="sm" onClick={() => setParam("new", "1")}>创建 Issue</Button>
            ) : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Issue</th>
                    <th className="px-4 py-3">优先级</th>
                    <th className="px-4 py-3">负责人 / 目标</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="w-12 px-4 py-3"><span className="sr-only">打开</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((issue) => (
                    <tr key={issue.id} className="group transition hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <Link className="font-medium text-slate-900 group-hover:text-indigo-700" to={scope.scopedPath(`/work/issues/${issue.id}`)}>
                          {issue.title}
                        </Link>
                        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-slate-400">
                          <span>{issue.identifier || issue.id.slice(0, 8)}</span>
                          {issue.kind === "endpoint_job" && <Badge>Endpoint 任务</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-4"><Badge tone={priorityTone(issue.priority)} className="capitalize">{issue.priority}</Badge></td>
                      <td className="max-w-52 truncate px-4 py-4 text-slate-600"><IssueOwnerOrTarget issue={issue} identities={identities} /></td>
                      <td className="px-4 py-4"><WorkStatusBadge status={issue.status} /></td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-500">{formatRelative(issue.updatedAt)}</td>
                      <td className="px-4 py-4 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {items.map((issue) => (
                <Link key={issue.id} to={scope.scopedPath(`/work/issues/${issue.id}`)} className="flex gap-3 px-4 py-4 hover:bg-slate-50">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400">
                    <CircleDotDashed className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{issue.title}</div>
                    <div className="mt-1 truncate text-xs text-slate-500"><IssueOwnerOrTarget issue={issue} identities={identities} /> · {formatRelative(issue.updatedAt)}</div>
                    <div className="mt-2 flex items-center gap-2"><WorkStatusBadge status={issue.status} /><Badge tone={priorityTone(issue.priority)} className="capitalize">{issue.priority}</Badge></div>
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300" />
                </Link>
              ))}
            </div>
          </>
        )}
      </WorkPanel>

      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => nextOpen ? setParam("new", "1") : closeCreate()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>创建 Issue</DialogTitle>
            <DialogDescription>记录该项工作的成果、背景，以及首个负责人或执行 Workflow。</DialogDescription>
          </DialogHeader>
          <DialogBody>
          <label className="grid gap-2 text-sm font-medium">共享<select aria-label="新 Issue 的共享范围" className="h-9 rounded-md border bg-white px-2" value={accessMode} onChange={e => setAccessMode(e.target.value as typeof accessMode)}><option value="private">私密 —— 仅自己可见</option><option value="namespace">空间成员</option></select><span className="text-xs font-normal text-muted-foreground">包含执行记录与附件。创建 Issue 后可再添加具体的协作者。</span></label>
            <form onSubmit={submit} className="space-y-5">
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                Title
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" required autoFocus />
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                Description
                <Textarea className="min-h-32" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="添加背景、约束或验收说明…" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  Priority
                  <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={priority} onChange={(event) => setPriority(event.target.value)}>
                    <option value="low">低</option>
                    <option value="normal">普通</option>
                    <option value="high">高</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  Owner or execution type
                  <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={assigneeType} onChange={(event) => { setAssigneeType(event.target.value); setAssigneeRef(""); }}>
                    <option value="agent">Agent</option>
                    <option value="team">Team</option>
                    <option value="workflow">Workflow</option>
                    <option value="human">人工</option>
                  </select>
                </label>
              </div>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                {assigneeType === "workflow" ? "执行 Workflow" : "负责人"} <span className="font-normal text-slate-400">（可选）</span>
                {assigneeType === "agent" ? (
                  <AgentPicker value={assigneeRef} onChange={setAssigneeRef} emptyLabel="选择 Agent" aria-label="Issue assignee Agent" />
                ) : assigneeType === "team" ? (
                  <NamedResourcePicker
                    value={assigneeRef}
                    onChange={setAssigneeRef}
                    options={teamOptions}
                    resourceLabel="Team"
                    loading={teams.isLoading}
                    error={teams.isError}
                    emptyLabel="选择 Team"
                    aria-label="Issue assignee Team"
                  />
                ) : assigneeType === "workflow" ? (
                  <NamedResourcePicker
                    value={assigneeRef}
                    onChange={setAssigneeRef}
                    options={workflowOptions}
                    resourceLabel="Workflow"
                    loading={workflows.isLoading}
                    error={workflows.isError}
                    emptyLabel="选择 Workflow"
                    aria-label="Issue 执行 Workflow"
                  />
                ) : (
                  <Input value={assigneeRef} onChange={(event) => setAssigneeRef(event.target.value)} placeholder={`${assigneeType} reference`} />
                )}
                {assigneeType === "workflow" && (
                  <span className="block text-xs font-normal text-slate-500">
                    Starts the latest published revision and records it as this Issue&apos;s execution target.
                  </span>
                )}
              </label>
              {create.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{create.error instanceof Error ? create.error.message : "无法创建该 Issue。请检查各字段后重试。"}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="ghost" onClick={closeCreate}>取消</Button>
                <Button type="submit" disabled={create.isPending || !title.trim()}>
                  {create.isPending ? "创建中…" : "Create issue"}
                </Button>
              </div>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </WorkPage>
  );
}

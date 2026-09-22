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

import {
  entityDisplayName,
  useEntityIdentities,
} from "@/components/EntityIdentity";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, Play, RefreshCw } from "lucide-react";
import {
  createDefinition,
  getDefinition,
  listDefinitions,
  listRevisions,
  listWorkflowPage,
  listWorkflowRuns,
  publishDefinition,
  startRun,
  updateDefinition,
  validateDefinition,
  type OrchestrationDefinition,
} from "@/api/orchestration";
import { listTeams } from "@/api/collaboration";
import { namespaceCan } from "@/lib/namespaceScope";
import { useControlPlaneScope } from "@/app/ScopeContext";
import { AgentPicker } from "@/components/AgentPicker";
import { PublishEndpointCard } from "@/components/PublishEndpointCard";
import { EmptyState } from "@/components/EmptyState";
import { Page, PageHeader } from "@/components/Page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatRelative } from "@/lib/format";
import { collectActivityPages } from "@/features/build/agents/useAgentActivity";
import {
  stateLabel,
  teamTone,
  terminalRun,
} from "@/features/teams/teamActivity";
import { parseWorkflow, summarizeOutput } from "./workflowModel";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowDesigner } from "./WorkflowDesigner";
const tabs = [
  "overview",
  "design",
  "activity",
  "versions",
  "connections",
  "settings",
];
function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md bg-red-50 p-3 text-sm text-destructive"
    >
      {String(error)}
    </p>
  ) : null;
}
export default function DefinitionsPage() {
  const { definitionId } = useParams();
  return definitionId ? (
    <WorkflowDetail key={definitionId} id={definitionId} />
  ) : (
    <WorkflowList />
  );
}
function WorkflowList() {
  const scope = useControlPlaneScope();
  const canCreate = namespaceCan(scope.roles, "configure");
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState("");
  const query = useQuery({
    queryKey: ["workflow-list", scope.tenant, scope.namespace, page, archived],
    queryFn: () =>
      listWorkflowPage(scope.tenant, scope.namespace, page * 20, archived),
  });
  const create = useMutation({
    mutationFn: () =>
      createDefinition({
        tenant: scope.tenant,
        namespace: scope.namespace,
        name: name.trim(),
        draftSpec: {
          nodes: [
            {
              key: "work",
              type: "agent",
              agentId: agent,
              issueMode: "inherit",
              failurePolicy: "fail_fast",
            },
          ],
          edges: [],
        },
      }),
    onSuccess: (result) =>
      navigate(
        scope.scopedPath(
          `/agent-center/workflows/${result.definition.id}?tab=design`,
        ),
      ),
  });
  return (
    <Page>
      <PageHeader
        title="Workflow"
        description="设计可重复的工作，发布版本并跟踪每次执行。"
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>创建 Workflow</Button>
          )
        }
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => {
            setArchived(e.target.checked);
            setPage(0);
          }}
        />
        Include archived
      </label>
      <ErrorMessage error={query.error} />
      {query.isLoading ? (
        <p>正在加载 Workflow…</p>
      ) : query.data?.definitions.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {query.data.definitions.slice(0, 20).map((d) => (
            <Link
              className="rounded-xl border border-border bg-white p-5 hover:border-primary"
              key={d.id}
              to={scope.scopedPath(`/agent-center/workflows/${d.id}`)}
            >
              <div className="flex justify-between gap-3">
                <span className="font-semibold">{d.name}</span>
                <Badge>
                  {d.archivedAt ? "已归档" : `Draft ${d.draftVersion}`}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {d.description || "暂无描述。"}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {d.draftSpec.nodes.length} steps · Updated{" "}
                {formatRelative(d.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        !query.isError && (
          <EmptyState
            title="暂无 Workflow"
            description={canCreate
              ? "创建 Workflow，配置其步骤，然后发布一个版本即可运行。"
              : "该空间中尚无可用 Workflow。"}
            action={canCreate && (
              <Button onClick={() => setCreating(true)}>创建 Workflow</Button>
            )}
          />
        )
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={(query.data?.definitions.length || 0) <= 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>创建 Workflow</DialogTitle>
            <DialogDescription>
              Start with an Agent step, then add branches, approvals or other
              steps.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              className="min-w-0 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <label className="block text-sm">
                Name
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <AgentPicker
                value={agent}
                onChange={setAgent}
                required
                aria-label="初始 Workflow Agent"
              />
              <ErrorMessage error={create.error} />
              <Button disabled={!name.trim() || !agent || create.isPending}>
                Create
              </Button>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
function WorkflowDetail({ id }: { id: string }) {
  const scope = useControlPlaneScope();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = tabs.includes(params.get("tab") || "")
    ? params.get("tab")!
    : "overview";
  const detail = useQuery({
    queryKey: ["workflow", scope.tenant, scope.namespace, id],
    queryFn: () => getDefinition(id),
  });
  const revisions = useQuery({
    queryKey: ["workflow-revisions", scope.tenant, scope.namespace, id],
    queryFn: () => listRevisions(id),
  });
  const history = useQuery({
    queryKey: ["workflow-history", scope.tenant, scope.namespace, id],
    queryFn: ({ signal }) =>
      collectActivityPages(
        async (offset) =>
          (await listWorkflowRuns(scope.tenant, scope.namespace, id, offset))
            .runs || [],
        signal,
      ),
    enabled: tab === "overview" || tab === "activity",
    refetchInterval: tab === "overview" || tab === "activity" ? 15000 : false,
    refetchIntervalInBackground: false,
  });
  const teams = useQuery({
    queryKey: ["workflow-teams", scope.tenant, scope.namespace],
    queryFn: () => listTeams(scope.tenant, scope.namespace),
    enabled: tab === "design",
  });
  const subrevisions = useQuery({
    queryKey: ["workflow-sub-revisions", scope.tenant, scope.namespace],
    queryFn: async () => {
      const all = await listDefinitions(scope.tenant, scope.namespace);
      const values = [];
      for (const d of all.definitions.filter((d) => !d.archivedAt)) {
        const result = await listRevisions(d.id);
        values.push(
          ...result.revisions.map((r) => ({
            id: r.id,
            name: `${d.name} · v${r.revision}`,
          })),
        );
      }
      return values;
    },
    enabled: tab === "design",
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<number>();
  const [validation, setValidation] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [launch, setLaunch] = useState(false);
  const [input, setInput] = useState("{}");
  const [issueMode, setIssueMode] = useState("new");
  const [issue, setIssue] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [page, setPage] = useState(0);
  const definition = detail.data?.definition;
  const text =
    draft ??
    JSON.stringify(definition?.draftSpec || { nodes: [], edges: [] }, null, 2);
  const parsed = parseWorkflow(text);
  const dirty = draft !== null;
  const canEdit = namespaceCan(scope.roles, "configure") && !definition?.archivedAt;
  const versions = revisions.data?.revisions || [];
  const selectedRevision =
    versions.find((r) => r.id === revisionId) || versions[0];
  const change = (value: string) => {
    if (draft === null) setBaseVersion(definition?.version);
    setDraft(value);
    setValidation("");
  };
  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: ["workflow", scope.tenant, scope.namespace, id],
    });
    void qc.invalidateQueries({
      queryKey: ["workflow-revisions", scope.tenant, scope.namespace, id],
    });
    void qc.invalidateQueries({
      queryKey: ["workflow-history", scope.tenant, scope.namespace, id],
    });
    void qc.invalidateQueries({ queryKey: ["workflow-list"] });
  };
  const save = useMutation({
    mutationFn: () =>
      updateDefinition(id, {
        draftSpec: parsed.spec,
        expectedVersion: baseVersion ?? definition?.version,
      }),
    onSuccess: () => {
      setDraft(null);
      setBaseVersion(undefined);
      setValidation("草稿已保存。准备好后校验并发布。");
      refresh();
    },
  });
  const validate = useMutation({
    mutationFn: () => validateDefinition(id, parsed.spec!),
    onSuccess: () => setValidation("有效的 workflow"),
    onError: (error) => setValidation(String(error)),
  });
  const publish = useMutation({
    mutationFn: () => publishDefinition(id, definition?.version),
    onSuccess: (r) => {
      setRevisionId(r.revision.id);
      setValidation(`Published version ${r.revision.revision}`);
      refresh();
    },
  });
  const start = useMutation({
    mutationFn: () => {
      const value = JSON.parse(input);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("输入必须是 JSON 对象。");
      return startRun(id, {
        revisionId: selectedRevision?.id,
        idempotencyKey: requestKey,
        input: value,
        ...(issueMode === "existing"
          ? { issueId: issue.trim() }
          : {
              issue: {
                title: issue.trim(),
                description: "来自 Workflow " + definition?.name,
              },
            }),
      });
    },
    onSuccess: (r) =>
      navigate(scope.scopedPath(`/work/executions/${r.run.id}`)),
  });
  const selectTab = (value: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", value);
    setParams(p);
  };
  const records = history.data || [];
  const identities = useEntityIdentities(
    records.map((r) => ({ type: "issue", ref: r.rootIssueId })),
  );
  if (detail.isLoading) return <Page>正在加载 Workflow…</Page>;
  if (!definition)
    return (
      <Page>
        <ErrorMessage error={detail.error || "Workflow 不可用"} />
        <Button onClick={() => detail.refetch()}>重试</Button>
      </Page>
    );
  const filtered = records.filter(
    (r) =>
      (state === "all" ||
        (state === "active" && !terminalRun(r.state)) ||
        r.state === state) &&
      `${r.id} ${entityDisplayName(identities, "issue", r.rootIssueId)} ${summarizeOutput(r.input)} ${summarizeOutput(r.output)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 12) - 1),
  );
  const runList = (compact = false) => (
    <div className="rounded-xl border border-border bg-white p-5">
      <h3 className="font-semibold">
        {compact ? "最近的执行" : "执行记录"}
      </h3>
      <ErrorMessage error={history.error} />
      {!compact && (
        <div className="my-4 flex flex-wrap gap-2">
          <Input
            className="min-w-48 flex-1"
            aria-label="搜索执行记录"
            placeholder="搜索工作项、输入、结果或 Run ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <select
            aria-label="执行状态"
            className="rounded border border-border p-2 text-sm"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">全部状态</option>
            <option value="active">进行中</option>
            {["succeeded", "partial_succeeded", "failed", "cancelled"].map(
              (v) => (
                <option key={v} value={v}>
                  {stateLabel(v)}
                </option>
              ),
            )}
          </select>
        </div>
      )}
      {history.isLoading ? (
        <p className="py-4 text-sm">正在加载执行记录…</p>
      ) : (
        (compact
          ? records.slice(0, 5)
          : filtered.slice(safePage * 12, (safePage + 1) * 12)
        ).map((r) => (
          <Link
            key={r.id}
            to={scope.scopedPath(`/work/executions/${r.id}`)}
            className="mt-3 block rounded-lg border border-border p-3 hover:bg-muted/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {entityDisplayName(identities, "issue", r.rootIssueId)}
              </span>
              <Badge tone={teamTone(r.state)}>{stateLabel(r.state)}</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {r.failureMessage ||
                r.waitReason ||
                summarizeOutput(r.output) ||
                summarizeOutput(r.input) ||
                "暂无输出。"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Version{" "}
              {versions.find((v) => v.id === r.definitionRevisionId)
                ?.revision || "—"}{" "}
              · Run {r.id.slice(0, 8)} · {formatRelative(r.createdAt)}
            </p>
          </Link>
        ))
      )}
      {!history.isLoading &&
        !history.error &&
        !(compact ? records : filtered).length && (
          <p className="py-5 text-sm text-muted-foreground">
            No matching executions.
          </p>
        )}
      {!compact && filtered.length > 12 && (
        <div className="mt-4 flex items-center justify-between text-xs">
          <span>
            {safePage * 12 + 1}–{Math.min((safePage + 1) * 12, filtered.length)}{" "}
            of {filtered.length}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!safePage}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(safePage + 1) * 12 >= filtered.length}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
  return (
    <Page className="space-y-5">
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        to={scope.scopedPath("/agent-center/workflows")}
      >
        <ArrowLeft className="h-4 w-4" />
        Workflows
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {definition.name}
            <Badge>
              {definition.archivedAt
                ? "已归档"
                : selectedRevision
                  ? `Published v${versions[0].revision}`
                  : "未发布"}
            </Badge>
          </span>
        }
        description={
          definition.description || "用于可重复工作的版本化 workflow。"
        }
        actions={
          <>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {namespaceCan(scope.roles, "write") && (
              <Button
                size="sm"
                disabled={!selectedRevision || !!definition.archivedAt}
                onClick={() => {
                  setRequestKey(crypto.randomUUID());
                  setLaunch(true);
                }}
              >
                <Play className="mr-2 h-4 w-4" />
                Run Workflow
              </Button>
            )}
          </>
        }
      />
      <nav
        aria-label="Workflow 分区"
        className="flex overflow-x-auto border-b border-border"
      >
        {tabs.map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => selectTab(t)}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm capitalize ${tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
          >
            {t === "design" ? "Workflow 设计" : t}
          </button>
        ))}
      </nav>
      <ErrorMessage error={detail.error || revisions.error} />
      {dirty && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          You have unsaved changes in Workflow design. Save the draft before
          publishing.
          {baseVersion !== definition.version
            ? " 服务端版本已变更；保存时会检测到冲突。"
            : ""}
        </p>
      )}
      {tab === "overview" && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              [
                "已发布版本",
                versions[0] ? `v${versions[0].revision}` : "None",
              ],
              [
                "步骤",
                String(
                  selectedRevision?.spec.nodes.length ??
                    definition.draftSpec.nodes.length,
                ),
              ],
              [
                "In progress",
                history.isLoading || history.error
                  ? "—"
                  : String(records.filter((r) => !terminalRun(r.state)).length),
              ],
              [
                "失败的执行",
                history.isLoading || history.error
                  ? "—"
                  : String(records.filter((r) => r.state === "failed").length),
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <div className="text-2xl font-semibold">{value}</div>
                <p className="mt-1 text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div>
              <p className="mb-3 text-sm font-medium">
                {selectedRevision
                  ? `Published topology · v${selectedRevision.revision}`
                  : "草稿拓扑"}
              </p>
              <WorkflowGraph
                nodes={(
                  selectedRevision?.spec || definition.draftSpec
                ).nodes.map((n) => ({ id: n.key, label: n.key, type: n.type }))}
                edges={
                  (selectedRevision?.spec || definition.draftSpec).edges || []
                }
                onSelect={() => selectTab("design")}
              />
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => selectTab("design")}
              >
                Open design
              </Button>
            </div>
            {runList(true)}
          </div>
        </>
      )}
      {tab === "design" && (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <Button
                  disabled={!parsed.spec || !dirty || save.isPending}
                  onClick={() => save.mutate()}
                >
                  Save draft
                </Button>
                <Button
                  variant="outline"
                  disabled={!parsed.spec || validate.isPending}
                  onClick={() => validate.mutate()}
                >
                  Validate
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    dirty || publish.isPending || save.isPending || !parsed.spec
                  }
                  onClick={() => publish.mutate()}
                >
                  Publish saved draft
                </Button>
                {dirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(null);
                      setBaseVersion(undefined);
                      setValidation("");
                    }}
                  >
                    Discard changes
                  </Button>
                )}
              </>
            )}
            <span className="self-center text-xs text-muted-foreground">
              Draft {definition.draftVersion} · Changes apply to future
              published versions.
            </span>
          </div>
          <ErrorMessage error={save.error || publish.error || parsed.error} />
          {validation && (
            <p role="status" className="text-sm">
              {validation}
            </p>
          )}
          <ErrorMessage error={teams.error || subrevisions.error} />
          {parsed.spec && (
            <WorkflowDesigner
              spec={parsed.spec}
              onChange={(v) => change(JSON.stringify(v, null, 2))}
              readOnly={!canEdit}
              teams={teams.data?.items || []}
              revisions={subrevisions.data || []}
            />
          )}
          <details open={!parsed.spec}>
            <summary className="cursor-pointer text-sm font-medium">
              Advanced Workflow JSON
            </summary>
            <Textarea
              aria-label="Workflow JSON"
              className="mt-3 min-h-80 font-mono text-xs"
              disabled={!canEdit}
              value={text}
              onChange={(e) => change(e.target.value)}
            />
          </details>
        </div>
      )}
      {tab === "activity" && runList()}
      {tab === "versions" && (
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            Published versions are immutable. Existing runs and APIs keep their
            selected version.
          </p>
          {versions.map((r) => (
            <div key={r.id} className="rounded-xl border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-semibold">Version {r.revision}</span>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {formatRelative(r.publishedAt)} · {r.spec.nodes.length}{" "}
                    steps
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRevisionId(r.id);
                      selectTab("connections");
                    }}
                  >
                    API target
                  </Button>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dirty}
                      onClick={() => {
                        change(JSON.stringify(r.spec, null, 2));
                        selectTab("design");
                      }}
                    >
                      Copy to draft
                    </Button>
                  )}
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm">
                  View immutable definition
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {JSON.stringify(r.spec, null, 2)}
                </pre>
              </details>
            </div>
          ))}
          {!versions.length && (
            <EmptyState
              title="暂无已发布版本"
              description="保存并校验草稿，然后在 Workflow 设计中发布它。"
            />
          )}
        </div>
      )}
      {tab === "connections" &&
        (selectedRevision ? (
          <div className="min-w-0 space-y-4">
            <label className="block text-sm">
              API target version
              <select
                className="ml-3 rounded border border-border p-2"
                value={selectedRevision.id}
                onChange={(e) => setRevisionId(e.target.value)}
              >
                {versions.map((r) => (
                  <option key={r.id} value={r.id}>
                    Version {r.revision}
                  </option>
                ))}
              </select>
            </label>
            <PublishEndpointCard
              targetType="orchestration_revision"
              targetRef={selectedRevision.id}
              targetName={definition.name}
              ownerPath={`/agent-center/workflows/${id}?tab=connections`}
              allowDeployToExisting
              relatedTargetRefs={versions.map((r) => r.id)}
            />
          </div>
        ) : (
          <EmptyState
            title="请先发布一个版本"
            description="API 始终指向某个已发布的 Workflow 版本。"
          />
        ))}
      {tab === "settings" && (
        <WorkflowSettings
          key={definition.version}
          definition={definition}
          onSaved={refresh}
        />
      )}
      <Dialog open={launch} onOpenChange={setLaunch}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Run {definition.name}</DialogTitle>
            <DialogDescription>
              Execute a published version with explicit input. Each request
              creates a new Run.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              className="min-w-0 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate();
              }}
            >
              <label className="block text-sm">
                Version
                <select
                  className="mt-1 block w-full rounded border border-border p-2"
                  value={selectedRevision?.id || ""}
                  onChange={(e) => setRevisionId(e.target.value)}
                >
                  {versions.map((r) => (
                    <option key={r.id} value={r.id}>
                      Version {r.revision}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Work item
                <select
                  className="mt-1 block w-full rounded border border-border p-2"
                  value={issueMode}
                  onChange={(e) => {
                    setIssueMode(e.target.value);
                    setIssue("");
                  }}
                >
                  <option value="new">创建 Issue</option>
                  <option value="existing">使用已有 Issue</option>
                </select>
              </label>
              <Input
                aria-label={
                  issueMode === "new" ? "Issue 标题" : "已有 Issue ID"
                }
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder={
                  issueMode === "new"
                    ? "这个 workflow 要完成什么？"
                    : "已有 Issue UUID"
                }
                required
              />
              <label className="block text-sm">
                Input JSON
                <Textarea
                  className="mt-1 min-h-32 font-mono text-xs"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
              </label>
              <ErrorMessage error={start.error} />
              <Button
                disabled={!issue.trim() || !selectedRevision || start.isPending}
              >
                Start version {selectedRevision?.revision}
              </Button>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
function WorkflowSettings({
  definition,
  onSaved,
}: {
  definition: OrchestrationDefinition;
  onSaved: () => void;
}) {
  const scope = useControlPlaneScope();
  const canEdit = namespaceCan(scope.roles, "configure");
  const [name, setName] = useState(definition.name);
  const [description, setDescription] = useState(definition.description || "");
  const [archived, setArchived] = useState(!!definition.archivedAt);
  const save = useMutation({
    mutationFn: () =>
      updateDefinition(definition.id, {
        name: name.trim(),
        description,
        archived,
        expectedVersion: definition.version,
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="max-w-2xl space-y-4 rounded-xl border border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <fieldset
        disabled={!canEdit || save.isPending}
        className="min-w-0 space-y-4"
      >
        <label className="block text-sm">
          Name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          Description
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archived · prevents starting or publishing new versions
        </label>
      </fieldset>
      <p className="break-all text-xs text-muted-foreground">
        {definition.id} · Version {definition.version}
      </p>
      <ErrorMessage error={save.error} />
      {canEdit && (
        <Button disabled={!name.trim() || save.isPending}>保存设置</Button>
      )}
    </form>
  );
}

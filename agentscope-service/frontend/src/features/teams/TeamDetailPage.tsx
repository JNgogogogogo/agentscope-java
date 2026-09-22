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

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getRoles } from "@/api/auth";
import { getTeamOverview } from "@/api/collaboration";
import { useControlPlaneScope } from "@/app/ScopeContext";
import { AgentIdentity } from "@/components/AgentPicker";
import { EmptyState } from "@/components/EmptyState";
import { Page, PageHeader } from "@/components/Page";
import { PublishEndpointCard } from "@/components/PublishEndpointCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TeamActivityPanel } from "./TeamActivityPanel";
import {
  TeamOrchestration,
  TeamSettings,
  TeamStructure,
} from "./TeamConfiguration";
import { teamTone, matchesActivity, type ActivityFilter } from "./teamActivity";
import { useTeamActivity } from "./useTeamActivity";

import { tabs, normalizeTeamTab } from "./teamNavigation";
export default function TeamDetailPage() {
  const { teamId = "" } = useParams();
  const scope = useControlPlaneScope();
  const [params, setParams] = useSearchParams();
  const tab = normalizeTeamTab(params.get("tab"));
  const requestedFilter = params.get("status");
  const filter: ActivityFilter = ["active", "attention", "completed"].includes(
    requestedFilter || "",
  )
    ? (requestedFilter as ActivityFilter)
    : "all";
  const roles = scope.roles;
  const canEdit = roles.includes("admin") || roles.includes("developer");
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["team-overview", teamId, scope.tenant, scope.namespace],
    queryFn: () => getTeamOverview(teamId),
    enabled: !!teamId,
    refetchInterval: tab === "overview" ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const activity = useTeamActivity(
    teamId,
    tab === "overview" || tab === "activity",
  );
  useEffect(() => {
    if (params.get("tab") && params.get("tab") !== tab) {
      const next = new URLSearchParams(params);
      next.set("tab", tab);
      if (params.get("tab") === "coordination") next.set("section", "rules");
      if (params.get("tab") === "members") next.set("section", "roles");
      setParams(next, { replace: true });
    }
  }, [params, setParams, tab]);
  const selectTab = (next: string, status?: ActivityFilter) => {
    const updated = new URLSearchParams(params);
    updated.set("tab", next);
    updated.delete("status");
    if (next !== "orchestration") updated.delete("section");
    if (status && status !== "all") updated.set("status", status);
    setParams(updated);
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["team-overview", teamId] });
    void qc.invalidateQueries({
      queryKey: ["team-activity", scope.tenant, scope.namespace, teamId],
    });
  };
  if (detail.isLoading)
    return (
      <Page>
        <p className="text-sm text-muted-foreground">正在加载 Team…</p>
      </Page>
    );
  if (!detail.data)
    return (
      <Page>
        <EmptyState
          title="Team 不可用"
          description={String(detail.error || "无法加载该 Team。")}
        />
      </Page>
    );
  const { team, overview } = detail.data;
  const records = activity.data?.records || [];
  const missing = activity.data?.missingRuns || 0;
  const warning = missing
    ? `${missing} 个 Run 状态无法加载。这些记录会以"状态不可用"展示，汇总计数不完整。`
    : activity.data?.missingIssues
      ? "部分 Issue 标题无法加载。执行记录仍然可用。"
      : undefined;
  const metric = (kind: ActivityFilter) =>
    activity.isLoading || !activity.data || activity.isError || missing
      ? "—"
      : records.filter((record) => matchesActivity(record, kind)).length;
  return (
    <Page className="max-w-[1440px] space-y-5 py-5 sm:py-6">
      <Link
        to={scope.scopedPath("/agent-center/teams")}
        className="inline-flex items-center self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Team
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {team.name}
            <Badge>{team.status}</Badge>
            <Badge tone={teamTone(overview.readiness)}>
              {overview.readiness}
            </Badge>
          </span>
        }
        description={
          team.description || "由 Lead 协调的 Agent 团队。"
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={detail.isFetching || activity.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>
          Lead{" "}
          <span className="ml-1 text-foreground">
            <AgentIdentity agentId={team.leaderAgentId} showId={false} />
          </span>
        </span>
        <span>{team.members?.length || 0} 个 worker</span>
        <span>已发布 {overview.endpoints.published} 个 API</span>
        <span>{overview.reason}</span>
      </div>
      <nav
        aria-label="Team 分区"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm ${tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {detail.isError && (
        <p role="alert" className="text-sm text-destructive">
          Team 信息刷新失败：{String(detail.error)}
        </p>
      )}
      {(tab === "overview" || tab === "activity") && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["active", "进行中", "仍在进行的协作"],
            [
              "attention",
              "需要关注",
              "失败、部分结果或等待中",
            ],
            [
              "completed",
              "成功 · 24h",
              "最近 24 小时成功完成",
            ],
            [
              "all",
              "已记录的协作",
              "有 Team 参与的 Execution Run",
            ],
          ].map(([key, label, help]) => (
            <button
              key={key}
              onClick={() => selectTab("activity", key as ActivityFilter)}
              className={`rounded-xl border border-border bg-white px-5 py-4 text-left transition hover:border-primary ${tab === "activity" && filter === key ? "border-primary" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold tracking-tight">
                  {metric(key as ActivityFilter)}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-1 text-sm font-medium">{label}</div>
              <p className="mt-1 text-xs text-muted-foreground">{help}</p>
            </button>
          ))}
        </div>
      )}
      {tab === "overview" && (
        <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <TeamActivityPanel
              records={records}
              loading={activity.isLoading}
              error={activity.error}
              warning={warning}
              compact
            />
            <Button variant="outline" onClick={() => selectTab("activity")}>
              查看全部活动
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-4">
            <TeamStructure team={team} overview={overview} compact />
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm font-medium">这个 Team 如何工作</p>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
                  {team.instructions ||
                    "Lead 接收请求，按需分派工作，并汇总结果。"}
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => selectTab("orchestration")}
                >
                  查看编排
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      {tab === "activity" && (
        <TeamActivityPanel
          records={records}
          loading={activity.isLoading}
          error={activity.error}
          warning={warning}
          filter={filter}
          onFilter={(value) => selectTab("activity", value)}
        />
      )}
      {tab === "orchestration" && (
        <TeamOrchestration
          team={team}
          overview={overview}
          canEdit={canEdit}
          onSaved={refresh}
        />
      )}
      {tab === "connections" && (
        <PublishEndpointCard
          targetType="team"
          targetRef={team.id}
          targetName={team.name}
          ownerPath={`/agent-center/teams/${team.id}?tab=connections`}
        />
      )}
      {tab === "settings" && (
        <TeamSettings
          key={team.version}
          team={team}
          canEdit={canEdit}
          onSaved={refresh}
        />
      )}
    </Page>
  );
}

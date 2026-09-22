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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ExternalLink, MessageSquare, MoreHorizontal, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createChat,
  deleteChat,
  listChatAgents,
  listChats,
  sendChatTurn,
  updateChat,
  type Chat,
  type ChatStatus,
} from '@/api/chats';
import { getRoles } from '@/api/auth';
import { useControlPlaneScope } from '@/app/ScopeContext';
import { EmptyState } from '@/components/EmptyState';
import { Page, PageHeader } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConversationSurface } from '@/features/conversation/ConversationSurface';
import { runtimeEventsToConversation, runtimeEventsToMessages } from '@/features/conversation/adapters';
import type { ConversationMessage } from '@/features/conversation/model';
import { finishesConversationTurn } from '@/features/conversation/turnState';
import { useSessionEvents } from '@/features/operate/lib/useSessionEvents';
import { formatRelative } from '@/lib/format';

function firstTitle(message: string): string {
  const value = message.trim().replace(/\s+/g, ' ');
  return value.length > 64 ? `${value.slice(0, 61)}…` : value;
}

function ChatListItem({ chat, selected, disabled, onSelect, onDelete, onRestore }: {
  chat: Chat; selected: boolean; disabled: boolean; onSelect: () => void;
  onDelete: () => void; onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <DropdownMenu.Root open={open} onOpenChange={setOpen}>
    <div className={`flex items-center rounded-xl ${selected ? 'bg-indigo-50 text-indigo-950' : 'hover:bg-muted/60'}`}
      onContextMenu={event => { event.preventDefault(); setOpen(true); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); setOpen(true); } }}>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 px-3 py-3 text-left">
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{chat.title}</span>{chat.pinned && <Pin className="h-3.5 w-3.5" />}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{chat.agentName}</span><span className="shrink-0">{formatRelative(chat.updatedAt)}</span></div>
      </button>
      <DropdownMenu.Trigger asChild><button type="button" className="mr-1 rounded p-2 hover:bg-white" aria-label={`${chat.title} 的更多操作`}><MoreHorizontal className="h-4 w-4" /></button></DropdownMenu.Trigger>
    </div>
    <DropdownMenu.Portal><DropdownMenu.Content sideOffset={4} align="end" className="z-[100] min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
      {chat.status === 'deleted'
        ? <DropdownMenu.Item disabled={disabled} onSelect={onRestore} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm outline-none focus:bg-accent"><ArchiveRestore className="h-4 w-4" />恢复对话</DropdownMenu.Item>
        : <DropdownMenu.Item disabled={disabled} onSelect={onDelete} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-red-700 outline-none focus:bg-red-50"><Trash2 className="h-4 w-4" />删除对话</DropdownMenu.Item>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

function ChatWorkspace({ chat, onChanged, initialDraft = '' }: { chat: Chat; onChanged: (chat?: Chat) => void; initialDraft?: string }) {
  const scope = useControlPlaneScope();
  const roles = getRoles().map(role => role.toLowerCase());
  const canInspectSession = roles.includes('admin') || roles.includes('operator');
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [pendingAfter, setPendingAfter] = useState(0);
  const [pendingMessage, setPendingMessage] = useState('');
  const [error, setError] = useState('');
  const timeline = useSessionEvents(chat.sessionId, { chatId: chat.id, enabled: true });
  const messages = runtimeEventsToMessages(timeline.events);
  const events = runtimeEventsToConversation(timeline.events);
  const latestUserSeq = Math.max(0, ...timeline.events.filter(event => event.role === 'user').map(event => event.seq ?? 0));
  const latestTerminalSeq = Math.max(0, ...timeline.events.filter(finishesConversationTurn).map(event => event.seq ?? 0));
  const runtimeBusy = latestUserSeq > latestTerminalSeq;

  useEffect(() => {
    setMessage(initialDraft);
    setPending(false);
    setPendingMessage('');
    setError('');
  }, [chat.id, initialDraft]);

  useEffect(() => {
    if (!pending) return;
    const finished = timeline.events.some((event) => {
      const seq = event.seq ?? 0;
      return seq > pendingAfter && finishesConversationTurn(event);
    });
    if (finished) {
      setPending(false);
      setPendingMessage('');
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    }
  }, [pending, pendingAfter, queryClient, timeline.events]);

  const optimistic: ConversationMessage[] = pendingMessage &&
    !messages.some(item => item.role === 'user' && item.blocks.some(block => block.text === pendingMessage))
    ? [{
      id: `pending-${chat.id}`,
      role: 'user',
      blocks: [{ id: `pending-text-${chat.id}`, kind: 'text', text: pendingMessage }],
      occurredAt: new Date().toISOString(),
      state: 'complete',
    }]
    : [];

  async function submit(value: string) {
    if (!value.trim() || pending || runtimeBusy) return;
    const after = Math.max(0, ...timeline.events.map(event => event.seq ?? 0));
    setPendingAfter(after);
    setPendingMessage(value.trim());
    setPending(true);
    setError('');
    try {
      await sendChatTurn(chat.id, value.trim());
      setMessage('');
      await timeline.refresh();
    } catch (cause) {
      setPending(false);
      setPendingMessage('');
      setError(cause instanceof Error ? cause.message : 'Failed to send message');
    }
  }

  const change = useMutation({
    mutationFn: (patch: { pinned?: boolean; status?: 'active' | 'archived' }) => updateChat(chat, patch),
    onSuccess: ({ chat: value }) => {
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      onChanged(value.status === 'archived' ? undefined : value);
    },
  });

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">{chat.title}</h2>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{chat.agentName}</span><Badge>{chat.status}</Badge>
          <span>更新于 {formatRelative(chat.updatedAt)}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {canInspectSession && <Button asChild size="sm" variant="outline"><Link to={scope.scopedPath(`/work/sessions/${encodeURIComponent(chat.sessionId)}`)}>Session 诊断<ExternalLink className="h-3.5 w-3.5" /></Link></Button>}
        <Button asChild size="sm" variant="outline"><Link to={scope.scopedPath(`/work/issues?new=1&fromChat=${encodeURIComponent(chat.id)}&title=${encodeURIComponent(chat.title)}&description=${encodeURIComponent(`通过与 ${chat.agentName} 的对话创建。`)}`)}>创建 Issue</Link></Button>
        <Button size="sm" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ pinned: !chat.pinned })}>
          {chat.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}{chat.pinned ? '取消固定' : '固定'}
        </Button>
        <Button size="sm" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ status: chat.status !== 'active' ? 'active' : 'archived' })}>
          {chat.status !== 'active' ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{chat.status !== 'active' ? '恢复' : '归档'}
        </Button>
      </div>
    </div>
    <ConversationSurface
      className="min-h-[42rem] max-h-[calc(100vh-15rem)]"
      messages={[...messages, ...optimistic]}
      events={events}
      source="个人对话"
      loading={timeline.loading}
      error={error || timeline.error}
      emptyMessage={`与 ${chat.agentName} 开始个人对话。此对话与 Issue 相互独立。`}
      composer={chat.status === 'active' ? {
        value: message,
        onChange: setMessage,
        onSubmit: submit,
        busy: pending || runtimeBusy,
        disabled: pending || runtimeBusy,
        placeholder: pending || runtimeBusy ? `${chat.agentName} 正在处理…` : `给 ${chat.agentName} 发消息…`,
      } : undefined}
      hasEarlierMessages={timeline.hasEarlier}
      loadingEarlierMessages={timeline.loadingEarlier}
      onLoadEarlierMessages={() => void timeline.loadEarlier()}
      hasEarlierEvents={timeline.hasEarlier}
      loadingEarlierEvents={timeline.loadingEarlier}
      onLoadEarlierEvents={() => void timeline.loadEarlier()}
    />
  </div>;
}

export default function ChatPage() {
  const scope = useControlPlaneScope();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<ChatStatus>('active');
  const [agentId, setAgentId] = useState(params.get('agent') ?? '');
  const [draft, setDraft] = useState('');
  const [retryDraft, setRetryDraft] = useState<{ chatId: string; text: string }>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const agentPickerRef = useRef<HTMLSelectElement>(null);
  // 每次点击「新建对话」自增，用于在面板已展开时把焦点移到 Agent 选择器，给出可见反馈
  const [focusPickerTick, setFocusPickerTick] = useState(0);
  useEffect(() => {
    if (focusPickerTick > 0) agentPickerRef.current?.focus();
  }, [focusPickerTick]);
  const chats = useQuery({
    queryKey: ['chats', scope.tenant, scope.namespace, view],
    queryFn: () => listChats(scope.tenant, scope.namespace, view),
  });
  const agents = useQuery({
    queryKey: ['chat-agents', scope.tenant, scope.namespace],
    queryFn: () => listChatAgents(scope.tenant, scope.namespace),
  });
  const chatId = params.get('chat') ?? '';
  const newMode = params.get('new') === '1';
  const selected = useMemo(() => chats.data?.items.find(item => item.id === chatId), [chatId, chats.data?.items]);

  useEffect(() => {
    if (!chatId && !newMode && !params.get('agent') && chats.data?.items[0]) {
      const next = new URLSearchParams(params);
      next.set('chat', chats.data.items[0].id);
      setParams(next, { replace: true });
    }
  }, [chatId, chats.data?.items, newMode, params, setParams]);

  function select(chat?: Chat, startNew = false) {
    setError('');
    setRetryDraft(undefined);
    const next = new URLSearchParams(params);
    if (chat) {
      next.delete('agent');
      next.delete('new');
      next.set('chat', chat.id);
    } else {
      next.delete('chat');
      if (startNew) next.set('new', '1');
      else next.delete('new');
    }
    // 目标状态与当前完全一致时用 replace，否则重复点击「新建对话」会往浏览器后退栈里压重复条目
    setParams(next, { replace: next.toString() === params.toString() });
  }

  const remove = useMutation({
    mutationFn: (chat: Chat) => deleteChat(chat),
    onSuccess: async (_, chat) => {
      queryClient.setQueriesData<{ items: Chat[] }>({ queryKey: ['chats'] }, data => data && ({ ...data, items: data.items.filter(item => item.id !== chat.id) }));
      if (chat.id === chatId) select();
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: cause => setError(cause instanceof Error ? cause.message : 'Unable to delete Chat'),
  });
  const restore = useMutation({
    mutationFn: (chat: Chat) => updateChat(chat, { status: 'active' }),
    onSuccess: async (_, chat) => {
      queryClient.setQueriesData<{ items: Chat[] }>({ queryKey: ['chats'] }, data => data && ({ ...data, items: data.items.filter(item => item.id !== chat.id) }));
      select();
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: cause => setError(cause instanceof Error ? cause.message : 'Unable to restore Chat'),
  });

  async function start(value: string) {
    if (!agentId || !value.trim() || creating) return;
    setCreating(true);
    setError('');
    let created: Chat | undefined;
    try {
      const result = await createChat({ tenant: scope.tenant, namespace: scope.namespace, agentId, title: firstTitle(value) });
      created = result.chat;
      await sendChatTurn(result.chat.id, value.trim());
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      setDraft('');
      select(result.chat);
    } catch (cause) {
      if (created) {
        await queryClient.invalidateQueries({ queryKey: ['chats'] });
        select(created);
        setRetryDraft({ chatId: created.id, text: value });
        setDraft('');
      }
      setError(cause instanceof Error ? cause.message : '无法开始对话');
    } finally {
      setCreating(false);
    }
  }

  const availableAgents = agents.data?.items ?? [];
  const chosenAgent = availableAgents.find(agent => agent.id === agentId);
  const viewLabel = { active: '活跃', archived: '已归档', deleted: '已删除' } as const;
  function startNewChat() {
    select(undefined, true);
    setFocusPickerTick(tick => tick + 1);
  }
  return <Page>
    <PageHeader title="对话" description="与 Agent 进行个人的多轮对话。需要共享协作和跟踪时，请创建 Issue。" actions={
      <Button onClick={startNewChat}><Plus className="mr-2 h-4 w-4" />新建对话</Button>
    } />
    {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="rounded-2xl border bg-white p-3">
        <div className="mb-3 flex rounded-lg bg-muted p-1">
          {(['active', 'archived', 'deleted'] as const).map(status => <button key={status} type="button" className={`flex-1 rounded-md px-2 py-1.5 text-sm ${view === status ? 'bg-white shadow-sm' : 'text-muted-foreground'}`} onClick={() => { setView(status); select(); }}>{viewLabel[status]}</button>)}
        </div>
        {view === 'deleted' && <p className="px-3 py-2 text-xs text-muted-foreground">已删除的对话可以恢复，执行诊断信息会保留。</p>}
        <div className="space-y-1">
          {(chats.data?.items ?? []).map(chat => <ChatListItem key={chat.id} chat={chat} selected={chat.id === chatId}
            disabled={remove.isPending || restore.isPending} onSelect={() => select(chat)}
            onDelete={() => remove.mutate(chat)} onRestore={() => restore.mutate(chat)} />)}
          {!chats.isLoading && !(chats.data?.items ?? []).length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无{viewLabel[view]}对话。</p>}
        </div>
      </aside>
      {selected ? <ChatWorkspace key={selected.id} chat={selected} onChanged={select} initialDraft={retryDraft?.chatId === selected.id ? retryDraft.text : ''} /> : <div className="space-y-4 rounded-2xl border bg-white p-6">
        <div><h2 className="text-xl font-semibold">开始新对话</h2><p className="mt-1 text-sm text-muted-foreground">选择一个支持对话的 Agent。Team 和 Workflow 的工作请从 Issue 开始。</p></div>
        <label className="grid max-w-xl gap-1.5 text-sm">Agent<select ref={agentPickerRef} className="h-11 rounded-lg border bg-background px-3" value={agentId} onChange={event => setAgentId(event.target.value)}>
          <option value="">选择 Agent…</option>
          {availableAgents.map(agent => <option key={agent.id} value={agent.id} disabled={agent.capability.state !== 'available'}>{agent.name}{agent.capability.state === 'available' ? '' : ` — ${agent.capability.state}`}</option>)}
        </select></label>
        {chosenAgent && <div className="max-w-xl rounded-xl border p-4 text-sm"><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /><strong>{chosenAgent.name}</strong><Badge tone={chosenAgent.capability.state === 'available' ? 'success' : 'warning'}>{chosenAgent.capability.state}</Badge></div><p className="mt-2 text-muted-foreground">{chosenAgent.description || chosenAgent.capability.reason}</p></div>}
        {availableAgents.length ? <ConversationSurface
          className="min-h-[28rem]"
          messages={[]}
          events={[]}
          source="新个人对话"
          emptyMessage={agentId ? '发送第一条消息即可创建这个对话。' : '请先选择一个 Agent。'}
          composer={{ value: draft, onChange: setDraft, onSubmit: start, busy: creating, disabled: creating || !agentId || chosenAgent?.capability.state !== 'available', placeholder: '你想处理什么事情？' }}
        /> : !agents.isLoading && <EmptyState title="没有可用于对话的 Agent" description="请先接入运行时，并配置一个支持对话的 Agent。" />}
      </div>}
    </div>
  </Page>;
}

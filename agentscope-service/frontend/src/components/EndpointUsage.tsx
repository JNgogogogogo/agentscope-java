import { useState } from 'react';
import type { Endpoint } from '@/api/agentEndpoints';
import { Button } from '@/components/ui/button';
import { endpointExamples } from './endpointExamples';

function CopyCode({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <section className="min-w-0"><div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{title}</h4><Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setError(''); } catch { setError('Copy unavailable. Select the code below to copy it.'); } }}>{copied ? 'Copied' : 'Copy'}</Button></div>{error && <p role="alert" className="text-xs text-red-700">{error}</p>}<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{code}</pre></section>;
}
export function EndpointUsage({ endpoint }: { endpoint: Endpoint }) {
  const samples = endpointExamples(endpoint, window.location.origin);
  const job = endpoint.invocationMode === 'job';
  return <details className="mt-3 rounded-lg border border-border bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">API 集成示例</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm">Release {endpoint.activeRelease ? `r${endpoint.activeRelease}` : '未发布'} · {job ? '异步任务' : '对话'} · {endpoint.authPolicy?.type === 'platform' ? '平台 Bearer Token' : 'Endpoint API Key'}</p>
      {endpoint.status !== 'published' && <p className="text-sm text-amber-800">提交请求前请先发布该 API。</p>}
      <p className="text-xs text-muted-foreground">Replace the credential and request ID, then edit the example input for your published contract. Reuse the same request ID only when retrying the same submission. Use the same credential for status, events and artifacts.</p>
      <CopyCode title="1. Submit a request" code={samples.submit} />
      <CopyCode title="202 Accepted response (example)" code={JSON.stringify(samples.accepted, null, 2)} />
      <CopyCode title="2. Check status" code={samples.status} />
      <p className="text-xs text-muted-foreground">{job ? 'Poll statusUrl at a reasonable interval, such as every 2 seconds. Read invocation.status and stop at completed, failed, cancelled or timed_out. A completed job exposes invocation.result; failures expose invocation.errorCode and invocation.errorMessage.' : 'Use statusUrl to inspect the conversation and eventsUrl to receive the current turn’s output. Submit subsequent messages to /invoke/v1/conversations/CONVERSATION_ID/turns with a new Idempotency-Key.'}</p>
      {job && <CopyCode title="完成状态响应（示例）" code={JSON.stringify(samples.completed, null, 2)} />}
      <CopyCode title="3. Stream events" code={samples.events} />
      {job && <p className="text-xs text-muted-foreground">在 GET /invoke/v1/jobs/INVOCATION_ID/artifacts 列出产物。用 Last-Event-ID 请求头中最后收到的事件 ID 续传事件。</p>}
      <details><summary className="cursor-pointer text-sm">已发布的输入与输出 Schema</summary><div className="mt-3 grid gap-4 lg:grid-cols-2"><CopyCode title={job ? '输入的 Schema' : '请求 Schema'} code={JSON.stringify(endpoint.inputSchema ?? {}, null, 2)} /><CopyCode title="结果 Schema" code={JSON.stringify(endpoint.outputSchema ?? {}, null, 2)} /></div></details>
      <p className="text-xs text-muted-foreground">400: invalid input or missing request ID. 401: invalid credential. 409: incompatible state or reused ID with different input. 413: payload too large. 429: rate limit reached. Inspect the response error and retry only after correcting the cause.</p>
    </div>
  </details>;
}

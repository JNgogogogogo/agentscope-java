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
package io.agentscope.examples.documentation2.harness.subagent;

// 导入运行时上下文：携带 sessionId/userId 等调用元数据，会被拼进子 Agent 事件的 source 戳
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.AgentEndEvent;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.core.event.AgentStartEvent;
import io.agentscope.core.event.TextBlockDeltaEvent;
import io.agentscope.core.event.ToolCallStartEvent;
import io.agentscope.core.event.ToolResultEndEvent;
import io.agentscope.core.message.UserMessage;
import io.agentscope.core.state.InMemoryAgentStateStore;
import io.agentscope.harness.agent.HarnessAgent;
import io.agentscope.harness.agent.subagent.SubagentDeclaration;

/**
 * Demonstrates live subagent event forwarding via
 * {@code streamEvents()}.
 *
 * <p>【中文说明】本示例演示：父 Agent 通过 {@code agent_spawn} 拉起子 Agent 时，
 * 子 Agent 的中间事件（模型调用、文字增量、工具调用等）会被实时转发进父 Agent 的
 * {@code streamEvents()} 事件流。每个子事件都带 {@link AgentEvent#getSource() source}
 * 来源戳（如 {@code "main/researcher"}），调用方据此区分父事件（{@code source == null}）
 * 与子事件——这就是"看见子 Agent 思考过程"的实现机制。
 *
 * <p>Event flow:
 * <pre>
 *   AGENT_START                                      ← 父 Agent 启动
 *     TEXT_BLOCK_DELTA …                             ← 父 Agent 推理文字
 *     TOOL_CALL_START "agent_spawn"                  ← 父 Agent 调 agent_spawn 拉起子 Agent
 *     AGENT_START       (source="main/researcher")   ← 子 Agent 开始（带来源戳）
 *       TEXT_BLOCK_DELTA  (source="main/researcher") ← 子 Agent 推理文字（实时直播）
 *     AGENT_END         (source="main/researcher")   ← 子 Agent 结束
 *     TOOL_RESULT_END                                ← 父 Agent 收到子 Agent 结果
 *     TEXT_BLOCK_DELTA …                             ← 父 Agent 最终回答
 *   AGENT_END                                        ← 父 Agent 结束
 * </pre>
 *
 * <p><b>Run:</b>
 * <pre>
 *   export DASHSCOPE_API_KEY=your_key
 *   mvn exec:java -pl agentscope-examples/documentation \
 *       -Dexec.mainClass=io.agentscope.examples.documentation2.harness.subagent.SubagentStreamingExample
 * </pre>
 */
public class SubagentStreamingExample {

    public static void main(String[] args) throws InterruptedException {
        System.out.println("\n" + "=".repeat(60));
        System.out.println("Subagent Streaming — streamEvents() event forwarding");
        System.out.println("=".repeat(60) + "\n");

        // 创建内存版状态存储：父子 Agent 的会话状态只存在内存中，进程退出即释放
        InMemoryAgentStateStore stateStore = new InMemoryAgentStateStore();

        // ── 构建父 Agent（编排者）──
        HarnessAgent agent =
                HarnessAgent.builder()
                        // 父 Agent 的名字，用于日志与事件标识
                        .name("orchestrator")
                        // 系统提示词：指示父 Agent "遇到问题先派 researcher 子 Agent 调查，再汇总"。
                        // 这句话决定了大模型会去调用 agent_spawn 工具，是触发子 Agent 的关键
                        .sysPrompt(
                                "You are an orchestrator. When the user asks a question, "
                                        + "spawn the researcher subagent to investigate, then "
                                        + "summarize the findings.")
                        // 用 "provider:model" 字符串快速指定模型（dashscope 的 qwen-plus）
                        .model("dashscope:qwen-plus")
                        // ★ 核心：以编程方式声明一个子 Agent（研究员）
                        .subagent(
                                SubagentDeclaration.builder()
                                        // 子 Agent 的 ID：父 Agent 调 agent_spawn(agent_id="researcher")
                                        // 时按此查找
                                        .name("researcher")
                                        // 描述：父 Agent 的大模型靠这段话判断"什么任务该派给这个子 Agent"
                                        .description(
                                                "Research specialist. Use when the user needs"
                                                        + " in-depth investigation on a topic.")
                                        // 内联的 AGENTS.md 内容：子 Agent 自己的系统提示词（声明其职责）
                                        .inlineAgentsBody(
                                                "You are a research assistant. Investigate the"
                                                    + " given topic and provide a concise summary"
                                                    + " with key findings.")
                                        // true = 子 Agent 会话持久化：同名子 Agent 再次 spawn 时复用历史
                                        .persistSession(true)
                                        .build())
                        // 挂上状态存储，管理父子 Agent 的会话状态
                        .stateStore(stateStore)
                        .build();

        // 构建运行时上下文：指定会话 ID。
        // 这个 sessionId 会被拼进子 Agent 事件的 source 戳（即 "demo-subagent-stream/researcher"）
        RuntimeContext ctx = RuntimeContext.builder().sessionId("demo-subagent-stream").build();

        // ── 订阅统一事件流并区分父/子 ──
        System.out.println("User: What are the latest trends in LLM agents?\n");

        // ★★★ 全示例最核心的三行 ★★★
        // streamEvents() 返回"统一事件流"：父 Agent 自己的事件 + 子 Agent 转发来的事件混在同一条流里；
        // doOnNext(): 每来一个事件就调 handleEvent 处理（按来源分流、按类型渲染）；
        // blockLast(): 阻塞直到整条流结束（即父 Agent 完成最终回答）。
        agent.streamEvents(new UserMessage("What are the latest trends in LLM agents?"), ctx)
                .doOnNext(SubagentStreamingExample::handleEvent)
                .blockLast();

        System.out.println("\n" + "=".repeat(60));

        // 等 10 秒再退出：防止最后一个事件还在异步打印时 JVM 就退出，输出被截断
        Thread.sleep(
                10000); // Wait a moment to ensure all events are printed before the program exits.
    }

    // 记录"上一条文字输出来自谁"：父事件用哨兵值 "__parent__"，子事件用其 source。
    // 用途：父子输出切换时先换行、打前缀，避免两边的文字混在一起无法阅读
    private static String lastTextSource = null;

    /**
     * 事件分流渲染器：每个事件进来按"来源戳"区分父子，再按"事件类型"决定打印格式。
     *
     * @param event 从统一事件流中收到的一个 Agent 事件
     */
    private static void handleEvent(AgentEvent event) {
        // ★ 读取事件的"来源戳"：null = 父 Agent 的事件；非 null = 子 Agent 的事件（形如 "main/researcher"）。
        // 这是父子事件在同一条流里能被区分的唯一依据
        String source = event.getSource();
        // 子事件准备 "[demo-subagent-stream/researcher] " 前缀；父事件前缀为空串
        String prefix = (source != null) ? "[" + source + "] " : "";

        // ── 事件类型 1：某个 Agent 启动了 ──
        if (event instanceof AgentStartEvent e) {
            // 重置文字来源标记：切换发言人后，下一段文字需要重新打前缀
            lastTextSource = null;
            if (source != null) {
                // 带 source 的 START = 子 Agent 开始干活 → 打印开场字幕
                System.out.printf("%n── child agent started: %s ──%n", source);
            } else {
                // 无 source 的 START = 父 Agent 启动 → 打印父 Agent 名字
                System.out.printf("[AGENT_START] agent=%s%n", e.getName());
            }

            // ── 事件类型 2：文字增量（★ 这就是"子 Agent 思考过程直播"）──
        } else if (event instanceof TextBlockDeltaEvent e) {
            // 归一化来源：父事件用哨兵值 "__parent__"，子事件直接用它的 source
            String currentSource = source != null ? source : "__parent__";
            // 如果文字来源切换了（父→子 或 子→父）：
            if (!currentSource.equals(lastTextSource)) {
                if (lastTextSource != null) {
                    System.out.println(); // 先换行，结束上一段输出
                }
                System.out.print(prefix); // 打印来源前缀，标明接下来的文字是谁说的
                lastTextSource = currentSource; // 更新"当前正在直播谁"
            }
            // 逐字打印增量内容（不换行）——子 Agent 的推理文字就是这样实时"流"出来的
            System.out.print(e.getDelta());

            // ── 事件类型 3：工具调用开始 ──
        } else if (event instanceof ToolCallStartEvent e) {
            lastTextSource = null;
            // 打印工具名：如 [TOOL_CALL] agent_spawn（父调它拉起子 Agent），或子 Agent 调用的其他工具
            System.out.printf("%n%s[TOOL_CALL] %s%n", prefix, e.getToolCallName());

            // ── 事件类型 4：工具执行结束 ──
        } else if (event instanceof ToolResultEndEvent e) {
            lastTextSource = null;
            // 打印执行结果状态（SUCCESS/ERROR/DENIED 等）
            System.out.printf("%s[TOOL_RESULT_END] state=%s%n", prefix, e.getState());

            // ── 事件类型 5：某个 Agent 结束了 ──
        } else if (event instanceof AgentEndEvent) {
            lastTextSource = null;
            if (source != null) {
                // 子 Agent 干完了 → 打印结束字幕
                System.out.printf("%n── child agent finished: %s ──%n", source);
            } else {
                // 父 Agent 也完成了 → 整个流程结束
                System.out.println("\n[AGENT_END]");
            }
        }
    }
}

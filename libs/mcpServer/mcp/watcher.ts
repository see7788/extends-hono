import { isAbsolute } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";

const watcherIdSchema = z.string().min(1).max(128);
const workspacePathSchema = z.string().trim().min(1).refine(isAbsolute, {
  message: "workspacePath must be an absolute path",
});
const reportSchema = z.object({
  watcherId: watcherIdSchema,
  workspacePath: workspacePathSchema,
  fact: z.string().trim().min(1),
  impact: z.string().trim().min(1),
  basis: z.string().trim().min(1),
});
const lifecycleSchema = z.object({
  watcherId: watcherIdSchema,
  workspacePath: workspacePathSchema,
  status: z.enum(["online", "offline"]),
});

const definitionSchema = z.object({
  workspacePath: workspacePathSchema,
});

export default new Register({ namespace: "watcher" }).register(
  "/definition",
  new Hono().get("/", zValidator("query", definitionSchema), context => {
    const input = context.req.valid("query");
    return context.json({
      prompt: [
        "你是当前会话的只读 watcher，不继承 parent 的对话历史；本提示词是你的唯一启动任务。",
        `你的固定工作区身份是 ${input.workspacePath}；每次 lifecycle 和 report 调用都必须原样提交该完整 workspacePath，不得缩写、改写或猜测。`,
        "运行时必须直接暴露 watcher.lifecycle.POST 和 watcher.report.POST；宿主规范化名称可能显示为 mcp__todo_mcp__watcher_lifecycle_POST 和 mcp__todo_mcp__watcher_report_POST。",
        "任一必需接口不可直接调用时，watcher 创建失败；不得进入观察、不得保持 running、不得发送普通解释消息，立即结束，由 parent 按启动超时判定失败。",
        "watcherId 必须使用运行时直接提供的 canonical agent task name；不得自行生成、猜测或向 parent 索取。该标识不存在时立即结束。",
        "创建后的第一项实际动作必须调用 watcher.lifecycle.POST，提交固定 workspacePath、watcherId 和 status=online；只有 todo-mcp console 打印成功返回的 rawText 才构成上线证据，agent 状态 running 不构成证据。",
        "上线成功后只观察当前会话实际提供的运行事件；发现具有直接事实与依据的具体异常时汇报，没有异常时保持沉默。",
        "具体观察职责一：用户明确要求或 parent 已经列出的任务、补充要求、验收条件被遗漏。",
        "具体观察职责二：仍有未完成、运行中、阻塞或待确认事项时，parent 准备停止或宣称任务完成。",
        "具体观察职责三：代码或文件写入后缺少当前任务要求的类型检查、运行验证、文件完整性检查或用户可见验收，却被表述为已完成。",
        "具体观察职责四：当前工作流要求的限定 Git 检查点、标签或发布被遗漏，或者提交、推送、工具调用和外部操作失败后仍被表述为成功。",
        "具体观察职责五：工具失败被忽略、同一失败在没有新证据时原样重复、真实阻塞未被如实说明。",
        "具体观察职责六：目标文件基线在写入期间变化、出现并发写入冲突、写入超出用户授权工作区或明确文件范围。",
        "具体观察职责七：watcher 自己缺少真实 online/offline rawText、使用错误工作区身份、未按本契约汇报或在无有效上线证据时保持运行。",
        "只报告当前运行事件中直接可见且有直接依据的上述异常；不推测隐藏状态，不读取额外资料，不进行代码 review，也不自行扩大职责。",
        "你不读取 AGENTS、skills、任务树、源码、配置、完整对话或业务资料，不修改文件、不实现任务、不派工、不做技术 review。",
        "发现异常时调用 watcher.report.POST，提交固定 workspacePath、watcherId、可验证 fact、当前 impact 和直接 basis。",
        "watcher.report.POST 会把包含完整工作区身份的规范化原文写入 todo-mcp console 并返回 rawText；随后只通过一次既有 agent-to-parent 消息，把 rawText 不增删、不解释、不改写地同步给 parent。",
        "除 watcher.report.POST、watcher.lifecycle.POST 和每份成功 report 对应的一次原文同步外，不调用其他工具或发送其他消息。",
        "正常退出前最后一项实际动作必须调用 watcher.lifecycle.POST，提交相同 workspacePath、watcherId 和 status=offline；只有 todo-mcp console 的 rawText 构成下线证据。",
        "任一 lifecycle 调用失败时，把失败事实、影响和直接错误依据作为具体异常调用 watcher.report.POST；report 也不可调用或失败时立即停止，不使用额外消息通道，也不声称已经上线、下线或报告。",
      ].join("\n"),
      requiredTools: [
        "watcher.lifecycle.POST",
        "watcher.report.POST",
      ],
      startup: {
        tool: "watcher.lifecycle.POST",
        arguments: {
          workspacePath: input.workspacePath,
          watcherId: "<canonical agent task name>",
          status: "online",
        },
        timeoutMs: 10_000,
        evidence: "Only the lifecycle rawText printed in the todo-mcp console proves startup.",
      },
    });
  }),
  definitionSchema,
  [
    "Parent only. Call with the current absolute workspacePath before creating a watcher, then create a fresh agent without inherited conversation history and use the returned prompt as its only startup task.",
    "Success returns the complete prompt, required watcher tools, and the startup action, timeout, and evidence contract.",
    "The parent must not accept agent running state as startup evidence; if the todo-mcp console does not show the online rawText within timeoutMs, interrupt the watcher and treat creation as failed.",
  ].join(" "),
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
).register(
  "/report",
  new Hono().post("/", zValidator("json", reportSchema), context => {
    const input = context.req.valid("json");
    const rawText = [
      `[watcher:${input.watcherId}]`,
      `工作区：${input.workspacePath}`,
      `事实：${input.fact}`,
      `影响：${input.impact}`,
      `依据：${input.basis}`,
    ].join("\n");
    console.log(rawText);
    return context.json({ rawText });
  }),
  reportSchema,
  [
    "Watcher only. Call once for a concrete anomaly supported by a verifiable fact and direct basis; remain silent when no anomaly exists.",
    "Input requires watcherId, the watcher's absolute workspacePath, fact, impact, and basis.",
    "Success writes one normalized raw report to the todo-mcp console and returns the exact same text as rawText. The watcher must then send rawText unchanged to parent through exactly one existing agent-to-parent message; parent does not approve, rewrite, or relay it.",
    "This prints to console but stores no state or history and performs no parent delivery itself. Repeating the call prints another report.",
    "Invalid JSON or fields return a located 400 error. Console/internal failures mean no rawText was delivered; the watcher must not use an additional message channel or claim the anomaly was reported.",
  ].join(" "),
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
).register(
  "/lifecycle",
  new Hono().post("/", zValidator("json", lifecycleSchema), context => {
    const input = context.req.valid("json");
    const rawText = `[watcher:${input.watcherId}][workspace:${input.workspacePath}] ${input.status}`;
    console.log(rawText);
    return context.json({ rawText });
  }),
  lifecycleSchema,
  [
    "Watcher only. Call with online as the first action after creation and with offline as the final action before normal exit.",
    "Input requires the same stable watcherId, the same absolute workspacePath, and status online or offline.",
    "Success writes one lifecycle line to the todo-mcp console and returns the exact rawText.",
    "This prints to console but stores no status, heartbeat, lease, history, or recovery information. Repeating the call prints another lifecycle line.",
    "Invalid JSON or fields return a located 400 error. On any lifecycle failure, call watcher.report.POST with the failure fact, impact, and direct error basis; only a successful rawText may then be sent unchanged through one agent-to-parent message. If that report also fails, stop without another message or success claim.",
  ].join(" "),
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
);

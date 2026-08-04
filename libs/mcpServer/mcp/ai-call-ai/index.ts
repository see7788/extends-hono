import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import workspaceAiContact, {
  cardSchema,
  inputSchema,
} from "mcp-server/mcp/ai-call-ai/WORKSPACE_AI_CONTACT.ts";
import Register from "mcp-server/public.ts";

export default new Register({
  namespace: "ai-call-ai",
  description: "在同一工作区内向另一个 AI 会话发送明确消息。",
}).register(
  "/WORKSPACE_AI_CONTACT",
  new Hono().get("/", zValidator("query", cardSchema), async context => {
    const input = context.req.valid("query");
    try {
      return context.text(
        await workspaceAiContact.card(input.workspacePath),
      );
    } catch (error) {
      throw new HTTPException(409, {
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }
  }),
  cardSchema,
  [
    "当用户索要“你的名片”“给我你的名片”“联系卡”，或询问任何近似的 AI 联系方式时必须立即调用。",
    "调用方只提供自己已知的完整 workspacePath，禁止要求用户提供 remoteDebuggingPort、编辑或执行命令、关闭当前 VS Code。",
    "工具自动从正在运行的 Code.exe 发现 remoteDebuggingPort，并只绑定当前已经打开的工作区与 Codex 面板；禁止启动第二个 VS Code 或第二个 AI 会话。",
    "成功返回的 WORKSPACE_AI_CONTACT 必须原样回复；用户拒绝或客户端不支持按钮时原样回复工具结果，不得暴露其他内部工具名或伪造名片。",
    "MCP 与普通 HTTP 调用都只读取当前热窗口，不启动窗口。",
  ].join(" "),
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
).register(
  "/WORKSPACE_AI_CONTACT",
  new Hono().post("/", zValidator("json", inputSchema), async context => {
    const input = context.req.valid("json");
    try {
      const senderContact = await workspaceAiContact.card(
        input.senderWorkspacePath,
      );
      return context.text(await workspaceAiContact.input({
        workspacePath: input.workspacePath,
        remoteDebuggingPort: input.remoteDebuggingPort,
        message: [
          `【来自 ${input.senderWorkspacePath} 路径的 AI】`,
          input.message,
          "",
          "你回复我时，执行以下联系卡：",
          senderContact,
        ].join("\n"),
      }));
    } catch (error) {
      throw new HTTPException(502, {
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    }
  }),
  inputSchema,
  [
    "当用户要求当前 AI 与另一个工作区 AI 说话、对话、联系、询问或发送消息时使用。",
    "优先直接执行对方 WORKSPACE_AI_CONTACT 中的函数；函数只使用当前 AI 自己已知的完整 senderWorkspacePath 和用户消息。",
    "POST 入口会自动发现发送方当前已运行的 VS Code Codex 窗口并生成 senderContact，再发送消息，使对方可以直接回复；禁止启动第二个 VS Code 或第二个 AI 会话，也禁止要求调用方预先取得或提供 senderContact、remoteDebuggingPort 或执行命令。",
    "只有缺少对方联系方式、目标存在歧义或无法确定要发送的内容时才向用户询问；不得猜测或使用当前 AI 的参数代替对方参数。",
    "调用会真实发送消息且不可自动重试；目标不唯一或发送未验证时会明确失败。",
  ].join(" "),
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
);

import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, normalize } from "node:path";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import Register from "../public";

const schema = z.object({
  workspacePath: z.string().trim().min(1).refine(isAbsolute, {
    message: "workspacePath must be an absolute path",
  }),
  remoteDebuggingPort: z.coerce.number().int().min(1).max(65535),
});

const route = new Hono().get("/", validator("query", (value, context) => {
  const input = schema.safeParse(value);
  if (!input.success) {
    return context.json({
      error: "CallmePropsInputInvalid",
      issues: input.error.issues,
    }, 400);
  }
  return input.data;
}), async context => {
  const input = context.req.valid("query");
  let workspacePath: string;
  try {
    workspacePath = await realpath(normalize(input.workspacePath));
    if (!(await stat(workspacePath)).isDirectory()) {
      return context.text(`workspacePath is not a directory: ${workspacePath}`, 400);
    }
  } catch (error) {
    return context.text(
      `Cannot resolve workspacePath "${input.workspacePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      400,
    );
  }

  const debuggerUrl = `http://127.0.0.1:${input.remoteDebuggingPort}`;
  let response: Response;
  try {
    response = await fetch(`${debuggerUrl}/json`);
  } catch (error) {
    return context.text(
      `Cannot reach the VS Code remote-debugging endpoint ${debuggerUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
    );
  }
  if (!response.ok) {
    return context.text(
      `VS Code remote-debugging endpoint returned ${response.status}: ${await response.text()}`,
      502,
    );
  }

  const targetList: unknown = await response.json();
  if (!Array.isArray(targetList)) {
    return context.text("VS Code remote-debugging endpoint did not return a target array.", 502);
  }
  const targets = targetList.flatMap(target => {
    if (!target || typeof target !== "object") return [];
    const value = target as Record<string, unknown>;
    if (
      typeof value.id !== "string"
      || typeof value.type !== "string"
      || typeof value.title !== "string"
      || typeof value.url !== "string"
      || typeof value.webSocketDebuggerUrl !== "string"
    ) return [];
    return [{
      id: value.id,
      parentId: typeof value.parentId === "string" ? value.parentId : undefined,
      title: value.title,
      type: value.type,
      url: value.url,
      webSocketDebuggerUrl: value.webSocketDebuggerUrl,
    }];
  });
  const workspaceName = basename(workspacePath);
  const workspacePages = targets.filter(target => (
    target.type === "page"
    && target.title.toLocaleLowerCase().includes(workspaceName.toLocaleLowerCase())
  ));
  if (workspacePages.length !== 1) {
    return context.text(
      `Expected one VS Code page for workspace "${workspaceName}", found ${workspacePages.length}.`,
      409,
    );
  }
  const page = workspacePages[0]!;
  const codexWebviews = targets.filter(target => {
    if (target.type !== "iframe" || target.parentId !== page.id) return false;
    try {
      return new URL(target.url).searchParams.get("extensionId") === "openai.chatgpt";
    } catch {
      return false;
    }
  });
  if (codexWebviews.length !== 1) {
    return context.text(
      `Expected one openai.chatgpt webview below VS Code page "${page.title}", found ${codexWebviews.length}.`,
      409,
    );
  }
  const codex = codexWebviews[0]!;

  return context.text([
    "把下面整段交给需要调用此 Codex 的 AI：",
    "",
    "请通过本机 VS Code 的 Chrome DevTools Protocol 向这个 Codex 发送消息。",
    `workspacePath: ${workspacePath}`,
    `workspaceName: ${workspaceName}`,
    `remoteDebuggingUrl: ${debuggerUrl}`,
    `verifiedVscodePageTitle: ${page.title}`,
    `verifiedVscodePageId: ${page.id}`,
    `verifiedCodexWebviewId: ${codex.id}`,
    `verifiedCodexWebSocketDebuggerUrl: ${codex.webSocketDebuggerUrl}`,
    "",
    "调用规则：",
    `1. 每次发送前重新读取 ${debuggerUrl}/json；上面的 target id 和 WebSocket URL 只证明生成联络文本时已核对成功，不得长期缓存。`,
    `2. 选择 title 包含 ${JSON.stringify(workspaceName)} 的唯一 type=page 目标，再选择 parentId 等于该 page.id、URL 参数 extensionId=openai.chatgpt 的唯一 type=iframe 目标。`,
    "3. 连接该 iframe 目标最新的 webSocketDebuggerUrl，并用 Runtime.evaluate 重新取得 document.getElementById(\"active-frame\").contentDocument。",
    "4. 在 active-frame 文档中重新定位唯一可见的 [role=\"textbox\"][contenteditable=\"true\"]；确认 iframe title 为 Codex，候选不唯一时停止，不得猜测。",
    "5. 聚焦输入框后用 Input.insertText 写入消息；需要真正发送时再派发 Enter，并验证输入框已清空且对话出现进展。",
    "6. 不复用 DOM 节点、快照 uid、旧 target id 或旧 WebSocket URL；不要操作其他 VS Code 页面或其他输入框。",
    "",
    "要发送的消息：<在这里填写>",
  ].join("\n"));
});

export default new Register().register(
  "/callme-props",
  route,
  schema,
  [
    "当用户要把当前 Codex 的可调用联络文本复制给另一个 AI 时使用。",
    "必填当前 AI 的 workspacePath 绝对路径和启动该 VS Code 窗口时使用的 remoteDebuggingPort。",
    "成功会核对工作区目录、127.0.0.1 调试端点、唯一 VS Code 页面和其 openai.chatgpt webview，然后返回一段可直接复制的 CDP 调用文本。",
    "此工具只生成联络参数和调用步骤，不发送消息；路径不存在、调试端点不可达或目标不唯一时会明确失败。",
  ].join(" "),
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
);

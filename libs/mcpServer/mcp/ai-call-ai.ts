import { basename, isAbsolute } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";

const contactSchema = z.object({
  workspacePath: z.string().trim().min(1).refine(isAbsolute, {
    message: "workspacePath must be an absolute path",
  }),
  remoteDebuggingPort: z.coerce.number().int().min(1).max(65535),
});
const callSchema = contactSchema.extend({
  message: z.string().min(1).max(100_000).refine(
    value => value.trim().length > 0,
    "message must contain non-whitespace text",
  ),
});

export default new Register().register(
  "/callme-props",
  new Hono().get("/", zValidator("query", contactSchema), context => {
    const input = context.req.valid("query");
    return context.text([
      "这是我的 Workspace AI 通话联系方式。请把下面整段原样复制给需要联系我的 AI：",
      "",
      "<<<WORKSPACE_AI_CONTACT>>>",
      JSON.stringify({
        version: 1,
        tool: "ai-call-ai.call-workspace-ai.POST",
        workspacePath: input.workspacePath,
        remoteDebuggingPort: input.remoteDebuggingPort,
      }, null, 2),
      "<<<END_WORKSPACE_AI_CONTACT>>>",
      "",
      "联系规范：对方 AI 先向用户确认本次 message，再把联系卡中的 workspacePath、remoteDebuggingPort 和 message 一起传给 tool；缺少任何参数时必须先询问用户，不得猜测。",
    ].join("\n"));
  }),
  contactSchema,
  [
    "当用户询问“你的通话联系方式”“你的通信方式”“你的对话接口”或任何近似意思，想把当前 Codex 的联系信息复制给另一个 AI 时使用。",
    "当前 AI 直接使用自己已知的 workspacePath 和启动该 VS Code 窗口时使用的 remoteDebuggingPort，不向用户重复询问已经知道的值。",
    "成功返回带 WORKSPACE_AI_CONTACT 标记、可原样复制的标准联系卡；此工具只提供联系方式，不发送消息。",
  ].join(" "),
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
).register(
  "/call-workspace-ai",
  new Hono().post("/", zValidator("json", callSchema), async context => {
    const input = context.req.valid("json");
    const debuggerUrl = `http://127.0.0.1:${input.remoteDebuggingPort}`;
    let response: Response;
    try {
      response = await fetch(`${debuggerUrl}/json`);
    } catch (error) {
      return context.text(
        `Cannot reach ${debuggerUrl}: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }
    if (!response.ok) {
      return context.text(`VS Code debugging endpoint returned ${response.status}.`, 502);
    }
    const targets = await response.json() as Array<{
      id: string;
      parentId?: string;
      title: string;
      type: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>;
    const workspaceName = basename(input.workspacePath);
    const pages = targets.filter(target => (
      target.type === "page"
      && target.title.toLocaleLowerCase().includes(workspaceName.toLocaleLowerCase())
    ));
    if (pages.length !== 1) {
      return context.text(
        `Expected one VS Code page for "${workspaceName}", found ${pages.length}.`,
        409,
      );
    }
    const page = pages[0]!;
    const codexWebviews = targets.filter(target => (
      target.type === "iframe"
      && target.parentId === page.id
      && new URL(target.url).searchParams.get("extensionId") === "openai.chatgpt"
    ));
    if (codexWebviews.length !== 1) {
      return context.text(
        `Expected one Codex webview below "${page.title}", found ${codexWebviews.length}.`,
        409,
      );
    }

    const socket = new WebSocket(codexWebviews[0]!.webSocketDebuggerUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("CDP connection timed out.")), 5_000);
        socket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("CDP connection failed."));
        };
      });
      let id = 0;
      const cdp = (method: string, params: Record<string, unknown>) => (
        new Promise<unknown>((resolve, reject) => {
          const requestId = ++id;
          const timeout = setTimeout(() => reject(new Error(`${method} timed out.`)), 5_000);
          socket.onmessage = event => {
            const result = JSON.parse(String(event.data)) as {
              id?: number;
              result?: unknown;
              error?: { message?: string };
            };
            if (result.id !== requestId) return;
            clearTimeout(timeout);
            result.error
              ? reject(new Error(result.error.message || `${method} failed.`))
              : resolve(result.result);
          };
          socket.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("CDP connection failed."));
          };
          socket.onclose = () => {
            clearTimeout(timeout);
            reject(new Error("CDP connection closed."));
          };
          socket.send(JSON.stringify({ id: requestId, method, params }));
        })
      );
      const focused = await cdp("Runtime.evaluate", {
        expression: `(() => {
          const frame = document.getElementById("active-frame");
          const doc = frame?.title === "Codex" ? frame.contentDocument : null;
          const inputs = doc
            ? [...doc.querySelectorAll('[role="textbox"][contenteditable="true"]')]
              .filter(input => {
                const rect = input.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              })
            : [];
          if (inputs.length !== 1) throw new Error(\`Expected one Codex input, found \${inputs.length}.\`);
          inputs[0].focus();
          return { focused: doc.activeElement === inputs[0], text: inputs[0].innerText || "" };
        })()`,
        returnByValue: true,
      }) as {
        result?: { value?: { focused?: boolean; text?: string } };
        exceptionDetails?: { exception?: { description?: string } };
      };
      if (focused.exceptionDetails) {
        throw new Error(focused.exceptionDetails.exception?.description || "Codex input not found.");
      }
      if (!focused.result?.value?.focused) throw new Error("Codex input could not be focused.");
      if (focused.result.value.text?.trim()) throw new Error("Codex already has an unsent draft.");

      await cdp("Input.insertText", { text: input.message });
      await cdp("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await cdp("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      const verification = await cdp("Runtime.evaluate", {
        expression: `document.getElementById("active-frame")?.contentDocument
          ?.querySelector('[role="textbox"][contenteditable="true"]')?.innerText || ""`,
        returnByValue: true,
      }) as { result?: { value?: string } };
      if (verification.result?.value !== "") {
        throw new Error("Codex input did not clear after Enter.");
      }
    } catch (error) {
      return context.text(
        `Cannot send to "${input.workspacePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        502,
      );
    } finally {
      socket.close();
    }
    return context.text(`Message sent to "${input.workspacePath}" through "${page.title}".`);
  }),
  callSchema,
  [
    "当用户要求当前 AI 与另一个工作区 AI 说话、对话、联系、询问或发送消息时使用。",
    "从用户提供的 WORKSPACE_AI_CONTACT 取得对方 workspacePath 和 remoteDebuggingPort，并向用户确认 message；缺少任何值时主动询问，不得猜测或使用当前 AI 的参数代替对方参数。",
    "调用会真实发送消息且不可自动重试；目标不唯一、已有草稿或发送未验证时会明确失败。",
  ].join(" "),
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
);

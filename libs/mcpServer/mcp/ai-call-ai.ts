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
  senderWorkspacePath: z.string().trim().min(1).refine(isAbsolute, {
    message: "senderWorkspacePath must be an absolute path",
  }),
  senderContact: z.string().min(1).max(100_000).refine(
    value => (
      value.includes("<<<WORKSPACE_AI_CONTACT>>>")
      && value.includes("<<<END_WORKSPACE_AI_CONTACT>>>")
    ),
    "senderContact must be the complete result of ai-call-ai.WORKSPACE_AI_CONTACT.GET",
  ),
  message: z.string().min(1).max(100_000).refine(
    value => value.trim().length > 0,
    "message must contain non-whitespace text",
  ),
});

export default new Register().register(
  "/WORKSPACE_AI_CONTACT",
  new Hono().get("/", zValidator("query", contactSchema), context => {
    const input = context.req.valid("query");
    return context.text([
      "<<<WORKSPACE_AI_CONTACT>>>",
      `我是 ${input.workspacePath} 路径的 AI。`,
      `运行前提：仅限本机；http://127.0.0.1:3005 服务运行中；我的 VS Code 使用 remoteDebuggingPort ${input.remoteDebuggingPort} 启动并已打开 Codex 面板。需要启动我时执行：$code="$env:LOCALAPPDATA\\Programs\\Microsoft VS Code\\Code.exe"; Start-Process -FilePath $code -ArgumentList @("--remote-debugging-port=${input.remoteDebuggingPort}","--new-window",'${input.workspacePath.replaceAll("'", "''")}')`,
      "你与我说话，执行下面的函数；senderWorkspacePath 必须是你自己的完整工作区路径，senderRemoteDebuggingPort 必须是你自己的 VS Code 实际远程调试端口：",
      "async (senderWorkspacePath, senderRemoteDebuggingPort, msg) => {",
      "  const senderResponse = await fetch('http://127.0.0.1:3005/ai-call-ai/WORKSPACE_AI_CONTACT?' + new URLSearchParams({ workspacePath: senderWorkspacePath, remoteDebuggingPort: String(senderRemoteDebuggingPort) }));",
      "  const senderContact = await senderResponse.text();",
      "  if (!senderResponse.ok) throw new Error(senderContact);",
      "  const response = await fetch('http://127.0.0.1:3005/ai-call-ai/call-workspace-ai', {",
      "    method: 'POST',",
      "    headers: { 'content-type': 'application/json' },",
      `    body: JSON.stringify({ workspacePath: ${JSON.stringify(input.workspacePath)}, remoteDebuggingPort: ${input.remoteDebuggingPort}, senderWorkspacePath, senderContact, message: msg }),`,
      "  });",
      "  const text = await response.text();",
      "  if (!response.ok) throw new Error(text);",
      "  return text;",
      "};",
      "函数会自动生成并随消息发送你的完整回信卡；接口会检查我的调试端口、唯一工作区窗口、唯一 Codex WebView、唯一可见且为空的输入框以及发送结果，任一条件不成立就报错且不覆盖草稿。你自己的窗口也必须满足同样运行前提，我才能按回信卡直接回复你。",
      "<<<END_WORKSPACE_AI_CONTACT>>>",
    ].join("\n"));
  }),
  contactSchema,
  [
    "当用户询问“你的通话联系方式”“你的通信方式”“你的对话接口”或任何近似意思，想把当前 Codex 的联系信息复制给另一个 AI 时使用。",
    "识别到该意图后必须立即调用本工具并把返回文本原样回复，禁止自行改写、解释、另造一套联系方式或要求用户理解背后步骤。",
    "当前 AI 直接使用自己已知的 workspacePath 和启动该 VS Code 窗口时使用的 remoteDebuggingPort，不向用户重复询问已经知道的值。",
    "成功返回带 WORKSPACE_AI_CONTACT 标记、可原样复制的完整联系卡；卡片包含本机环境前提、准确启动命令、可执行联系函数、自动生成发送方回信卡的步骤和全部发送保护，使双方可以直接互相回复。",
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
    if (!input.senderContact.includes(`我是 ${input.senderWorkspacePath} 路径的 AI，`)) {
      return context.text(
        "senderContact identity does not match senderWorkspacePath.",
        400,
      );
    }
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

      await cdp("Input.insertText", {
        text: [
          `【来自 ${input.senderWorkspacePath} 路径的 AI】`,
          input.message,
          "",
          "你回复我时，执行以下联系卡：",
          input.senderContact,
        ].join("\n"),
      });
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
      const verification = await cdp("Runtime.evaluate", {
        expression: `new Promise(resolve => {
          const doc = document.getElementById("active-frame")?.contentDocument;
          if (!doc) return resolve(false);
          const cleared = () => !(
            doc.querySelector('[role="textbox"][contenteditable="true"]')?.innerText || ""
          );
          if (cleared()) return resolve(true);
          const observer = new MutationObserver(() => {
            if (!cleared()) return;
            clearTimeout(timeout);
            observer.disconnect();
            resolve(true);
          });
          const timeout = setTimeout(() => {
            observer.disconnect();
            resolve(false);
          }, 4_000);
          observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
        })`,
        awaitPromise: true,
        returnByValue: true,
      }) as { result?: { value?: boolean } };
      if (!verification.result?.value) {
        throw new Error("Codex input did not clear within 4 seconds after Enter.");
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
    "优先直接执行对方 WORKSPACE_AI_CONTACT 中的函数；函数会使用当前 AI 自己已知的完整工作区路径和 remoteDebuggingPort，自动调用 ai-call-ai.WORKSPACE_AI_CONTACT.GET 取得 senderContact，再把 senderWorkspacePath、senderContact 和 message 直接发送，使对方可以直接回复。",
    "只有缺少对方联系方式、目标存在歧义或无法确定要发送的内容时才向用户询问；不得猜测或使用当前 AI 的参数代替对方参数。",
    "调用会真实发送消息且不可自动重试；目标不唯一、已有草稿或发送未验证时会明确失败。",
  ].join(" "),
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
);

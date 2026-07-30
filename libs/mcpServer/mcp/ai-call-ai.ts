import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { zValidator } from "@hono/zod-validator";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import Register from "../public";

const contactSchema = z.object({
  workspacePath: z.string().trim().min(1).refine(isAbsolute, {
    message: "workspacePath must be an absolute path",
  }),
});
const callSchema = contactSchema.extend({
  remoteDebuggingPort: z.coerce.number().int().min(1).max(65535),
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
type DebugTarget = {
  id: string;
  parentId?: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};
type ContactTarget = {
  page: DebugTarget & { webSocketDebuggerUrl: string };
  webview: DebugTarget & { webSocketDebuggerUrl: string };
};
type Contact = ContactTarget & { port: number };
type McpEnv = {
  Bindings: {
    mcpServer?: McpServer;
  };
};

function contactPorts(workspacePath: string) {
  const seed = createHash("sha256")
    .update(resolve(workspacePath).toLocaleLowerCase())
    .digest()
    .readUInt16BE();
  return Array.from(
    { length: 64 },
    (_, index) => 40_000 + ((seed + index) % 9_000),
  );
}

function portAvailable(port: number) {
  return new Promise<boolean>((fulfilled, rejected) => {
    const server = createServer();
    server.unref();
    server.once("error", error => {
      const code = "code" in error ? String(error.code) : undefined;
      if (code === "EADDRINUSE" || code === "EACCES") {
        fulfilled(false);
        return;
      }
      rejected(error);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(error => error ? rejected(error) : fulfilled(true));
    });
  });
}

async function contactTargetsRead(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!response.ok) {
    throw new Error(`VS Code debugging endpoint ${port} returned ${response.status}.`);
  }
  return await response.json() as DebugTarget[];
}

function contactPageRead(
  workspacePath: string,
  port: number,
  targets: DebugTarget[],
) {
  const workspaceName = basename(workspacePath);
  const pages = targets.filter(target => (
    target.type === "page"
    && target.title.toLocaleLowerCase().includes(workspaceName.toLocaleLowerCase())
  ));
  const page = pages[0];
  if (pages.length !== 1 || !page?.webSocketDebuggerUrl) {
    throw new Error(
      `端口 ${port} 未找到唯一的 ${workspacePath} VS Code 工作区窗口。`,
    );
  }
  return {
    ...page,
    webSocketDebuggerUrl: page.webSocketDebuggerUrl,
  };
}

async function contactTargetRead(
  workspacePath: string,
  port: number,
): Promise<ContactTarget> {
  const targets = await contactTargetsRead(port);
  const page = contactPageRead(workspacePath, port, targets);
  const codexWebviews = targets.filter(target => (
    target.type === "iframe"
    && target.parentId === page.id
    && new URL(target.url).searchParams.get("extensionId") === "openai.chatgpt"
  ));
  const webview = codexWebviews[0];
  if (codexWebviews.length !== 1 || !webview?.webSocketDebuggerUrl) {
    throw new Error(
      `端口 ${port} 未找到唯一的 ${workspacePath} Codex 插件面板。`,
    );
  }
  return {
    page,
    webview: {
      ...webview,
      webSocketDebuggerUrl: webview.webSocketDebuggerUrl,
    },
  };
}

async function contactPanelOpen(workspacePath: string, port: number) {
  const page = contactPageRead(
    workspacePath,
    port,
    await contactTargetsRead(port),
  );
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  try {
    await new Promise<void>((fulfilled, rejected) => {
      const timeout = setTimeout(
        () => rejected(new Error("VS Code CDP connection timed out.")),
        5_000,
      );
      socket.onopen = () => {
        clearTimeout(timeout);
        fulfilled();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        rejected(new Error("VS Code CDP connection failed."));
      };
    });
    let id = 0;
    const cdp = (method: string, params: Record<string, unknown>) => (
      new Promise<void>((fulfilled, rejected) => {
        const requestId = ++id;
        const timeout = setTimeout(
          () => rejected(new Error(`${method} timed out.`)),
          5_000,
        );
        socket.onmessage = event => {
          const result = JSON.parse(String(event.data)) as {
            id?: number;
            error?: { message?: string };
          };
          if (result.id !== requestId) return;
          clearTimeout(timeout);
          result.error
            ? rejected(new Error(result.error.message || `${method} failed.`))
            : fulfilled();
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          rejected(new Error("VS Code CDP connection failed."));
        };
        socket.onclose = () => {
          clearTimeout(timeout);
          rejected(new Error("VS Code CDP connection closed."));
        };
        socket.send(JSON.stringify({ id: requestId, method, params }));
      })
    );
    await cdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "p",
      code: "KeyP",
      modifiers: 10,
      windowsVirtualKeyCode: 80,
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "p",
      code: "KeyP",
      modifiers: 10,
      windowsVirtualKeyCode: 80,
    });
    await delay(500);
    await cdp("Input.insertText", {
      text: "Codex: Open Codex Sidebar",
    });
    await delay(500);
    await cdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
  } finally {
    socket.close();
  }
}

async function contactFind(workspacePath: string): Promise<Contact | undefined> {
  for (const port of contactPorts(workspacePath)) {
    if (await portAvailable(port)) continue;
    const target = await contactTargetRead(workspacePath, port)
      .catch(() => undefined);
    if (target) return { port, ...target };
  }
  return undefined;
}

async function contactPortAllocate(workspacePath: string) {
  for (const port of contactPorts(workspacePath)) {
    if (await portAvailable(port)) return port;
  }
  throw new Error("未能为 VS Code 联系窗口分配空闲端口。");
}

async function contactStart(workspacePath: string): Promise<Contact> {
  if (process.platform !== "win32") {
    throw new Error("自动启动联系窗口目前只支持 Windows。");
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) throw new Error("LOCALAPPDATA is unavailable.");
  const codePath = join(localAppData, "Programs", "Microsoft VS Code", "Code.exe");
  await access(codePath);
  const port = await contactPortAllocate(workspacePath);
  await new Promise<void>((fulfilled, rejected) => {
    const child = spawn(codePath, [
      `--user-data-dir=${join(localAppData, "extends-hono", "ai-contact", String(port))}`,
      `--remote-debugging-port=${port}`,
      "--new-window",
      workspacePath,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", rejected);
    child.once("spawn", () => {
      child.unref();
      fulfilled();
    });
  });
  const deadline = Date.now() + 45_000;
  let lastError: unknown;
  let panelOpenAfter = 0;
  while (Date.now() < deadline) {
    try {
      return { port, ...await contactTargetRead(workspacePath, port) };
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= panelOpenAfter) {
      panelOpenAfter = Date.now() + 3_000;
      try {
        await contactPanelOpen(workspacePath, port);
      } catch (error) {
        lastError = error;
      }
    }
    await delay(500);
  }
  throw new Error(
    `联系窗口启动后未在 45 秒内就绪：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function contactCard(workspacePath: string, port: number) {
  return [
    "<<<WORKSPACE_AI_CONTACT>>>",
    `我是 ${workspacePath} 路径的 AI。`,
    `运行前提：仅限本机；http://127.0.0.1:3005 服务运行中；我的 VS Code 联系窗口使用 remoteDebuggingPort ${port} 并已打开 Codex 面板。`,
    "你与我说话，执行下面的函数；senderWorkspacePath 必须是你自己的完整工作区路径：",
    "async (senderWorkspacePath, msg) => {",
    "  const senderResponse = await fetch('http://127.0.0.1:3005/ai-call-ai/WORKSPACE_AI_CONTACT?' + new URLSearchParams({ workspacePath: senderWorkspacePath }));",
    "  const senderContact = await senderResponse.text();",
    "  if (!senderResponse.ok) throw new Error(senderContact);",
    "  const response = await fetch('http://127.0.0.1:3005/ai-call-ai/WORKSPACE_AI_CONTACT', {",
    "    method: 'POST',",
    "    headers: { 'content-type': 'application/json' },",
    `    body: JSON.stringify({ workspacePath: ${JSON.stringify(workspacePath)}, remoteDebuggingPort: ${port}, senderWorkspacePath, senderContact, message: msg }),`,
    "  });",
    "  const text = await response.text();",
    "  if (!response.ok) throw new Error(text);",
    "  return text;",
    "};",
    "函数会自动取得发送方已经启用的完整回信卡并随消息发送；接口会检查我的调试端口、唯一工作区窗口、唯一 Codex WebView、唯一可见且为空的输入框以及发送结果，任一条件不成立就报错且不覆盖草稿。",
    "<<<END_WORKSPACE_AI_CONTACT>>>",
  ].join("\n");
}

export default new Register().register(
  "/WORKSPACE_AI_CONTACT",
  new Hono<McpEnv>().get("/", zValidator("query", contactSchema), async context => {
    const input = context.req.valid("query");
    const current = await contactFind(input.workspacePath);
    if (current) {
      return context.text(contactCard(input.workspacePath, current.port));
    }
    const mcpServer = context.env.mcpServer;
    if (!mcpServer) {
      return context.text("当前工作区尚未启用 AI 联系窗口。", 409);
    }
    try {
      const contact = await contactFind(input.workspacePath)
        ?? await contactStart(input.workspacePath);
      return context.text(contactCard(input.workspacePath, contact.port));
    } catch (error) {
      return context.text(
        error instanceof Error ? error.message : String(error),
        500,
      );
    }
  }),
  contactSchema,
  [
    "当用户索要“你的名片”“给我你的名片”“联系卡”，或询问任何近似的 AI 联系方式时必须立即调用。",
    "调用方只提供自己已知的完整 workspacePath，禁止要求用户提供 remoteDebuggingPort、编辑或执行命令、关闭当前 VS Code。",
    "本工具的执行确认就是唯一按钮；用户确认后，已有可联系窗口时直接返回完整联系卡，没有时在方法内分配空闲端口、保留当前窗口、启动新的 VS Code 窗口并等待真实验证。",
    "成功返回的 WORKSPACE_AI_CONTACT 必须原样回复；用户拒绝或客户端不支持按钮时原样回复工具结果，不得暴露其他内部工具名或伪造名片。",
    "通过普通 HTTP 调用时只读取已经启用的联系卡，不启动窗口。",
  ].join(" "),
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
).register(
  "/WORKSPACE_AI_CONTACT",
  new Hono().post("/", zValidator("json", callSchema), async context => {
    const input = context.req.valid("json");
    if (!input.senderContact.includes(`我是 ${input.senderWorkspacePath} 路径的 AI。`)) {
      return context.text(
        "senderContact identity does not match senderWorkspacePath.",
        400,
      );
    }
    let contact: ContactTarget;
    try {
      contact = await contactTargetRead(
        input.workspacePath,
        input.remoteDebuggingPort,
      );
    } catch (error) {
      return context.text(
        `Cannot reach "${input.workspacePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        502,
      );
    }
    const socket = new WebSocket(contact.webview.webSocketDebuggerUrl);
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
    return context.text(
      `Message sent to "${input.workspacePath}" through "${contact.page.title}".`,
    );
  }),
  callSchema,
  [
    "当用户要求当前 AI 与另一个工作区 AI 说话、对话、联系、询问或发送消息时使用。",
    "优先直接执行对方 WORKSPACE_AI_CONTACT 中的函数；函数只使用当前 AI 自己已知的完整工作区路径，自动调用 ai-call-ai.WORKSPACE_AI_CONTACT.GET 取得已经启用的 senderContact，再把 senderWorkspacePath、senderContact 和 message 直接发送，使对方可以直接回复。",
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

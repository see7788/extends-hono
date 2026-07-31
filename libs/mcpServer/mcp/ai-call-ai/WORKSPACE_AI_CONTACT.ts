import { execFile } from "node:child_process";
import { basename, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

export const cardSchema = z.object({
  workspacePath: z.string().trim().min(1).refine(isAbsolute, {
    message: "workspacePath must be an absolute path",
  }),
});
export const inputSchema = cardSchema.extend({
  remoteDebuggingPort: z.coerce.number().int().min(1).max(65535),
  senderWorkspacePath: z.string().trim().min(1).refine(isAbsolute, {
    message: "senderWorkspacePath must be an absolute path",
  }),
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
type Contact = {
  workspacePath: string;
  remoteDebuggingPort: number;
  page: DebugTarget & { webSocketDebuggerUrl: string };
  webview: DebugTarget & { webSocketDebuggerUrl: string };
};

class WORKSPACE_AI_CONTACT {
  private readonly ports = new Map<string, number>();

  /** 为当前热 VS Code Codex 窗口创建联系卡。 */
  async card(workspacePath: string) {
    const contact = await this.target(workspacePath);
    return [
      "<<<WORKSPACE_AI_CONTACT>>>",
      `我是 ${workspacePath} 路径的 AI。`,
      `运行前提：仅限本机；http://127.0.0.1:3005 服务运行中；我当前已运行的 VS Code 窗口使用 remoteDebuggingPort ${contact.remoteDebuggingPort} 并已打开 Codex 面板。`,
      "你与我说话，执行下面的函数；senderWorkspacePath 必须是你自己的完整工作区路径：",
      "async (senderWorkspacePath, msg) => {",
      "  const response = await fetch('http://127.0.0.1:3005/ai-call-ai/WORKSPACE_AI_CONTACT', {",
      "    method: 'POST',",
      "    headers: { 'content-type': 'application/json' },",
      `    body: JSON.stringify({ workspacePath: ${JSON.stringify(workspacePath)}, remoteDebuggingPort: ${contact.remoteDebuggingPort}, senderWorkspacePath, message: msg }),`,
      "  });",
      "  const text = await response.text();",
      "  if (!response.ok) throw new Error(text);",
      "  return text;",
      "};",
      "接口会自动发现发送方当前已运行的 VS Code Codex 窗口、生成完整回信卡并随消息发送；随后检查我的调试端口、唯一工作区窗口、唯一 Codex WebView 和唯一可见输入框，用本次消息替换输入框现有内容并检查发送结果，任一条件不成立就报错。",
      "<<<END_WORKSPACE_AI_CONTACT>>>",
    ].join("\n");
  }

  /** 向目标热 VS Code Codex 输入消息并提交。 */
  async input(input: Omit<z.infer<typeof inputSchema>, "senderWorkspacePath">) {
    const contact = await this.target(
      input.workspacePath,
      input.remoteDebuggingPort,
    ).catch(error => {
      throw new Error(
        `Cannot reach "${input.workspacePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    });
    const socket = new WebSocket(contact.webview.webSocketDebuggerUrl);
    try {
      await new Promise<void>((fulfilled, rejected) => {
        const timeout = setTimeout(
          () => rejected(new Error("CDP connection timed out.")),
          2_000,
        );
        socket.onopen = () => {
          clearTimeout(timeout);
          fulfilled();
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          rejected(new Error("CDP connection failed."));
        };
      });
      let id = 0;
      const cdp = (method: string, params: Record<string, unknown>) => (
        new Promise<unknown>((fulfilled, rejected) => {
          const requestId = ++id;
          const timeout = setTimeout(
            () => rejected(new Error(`${method} timed out.`)),
            2_000,
          );
          socket.onmessage = event => {
            const result = JSON.parse(String(event.data)) as {
              id?: number;
              result?: unknown;
              error?: { message?: string };
            };
            if (result.id !== requestId) return;
            clearTimeout(timeout);
            result.error
              ? rejected(new Error(result.error.message || `${method} failed.`))
              : fulfilled(result.result);
          };
          socket.onerror = () => {
            clearTimeout(timeout);
            rejected(new Error("CDP connection failed."));
          };
          socket.onclose = () => {
            clearTimeout(timeout);
            rejected(new Error("CDP connection closed."));
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
          const selection = doc.getSelection();
          if (!selection) throw new Error("Codex input selection is unavailable.");
          const range = doc.createRange();
          range.selectNodeContents(inputs[0]);
          selection.removeAllRanges();
          selection.addRange(range);
          return {
            focused: doc.activeElement === inputs[0],
            selected: selection.rangeCount === 1
              && inputs[0].contains(selection.anchorNode)
              && inputs[0].contains(selection.focusNode),
            messages: doc.querySelectorAll('[data-user-message-bubble="true"]').length,
          };
        })()`,
        returnByValue: true,
      }) as {
        result?: { value?: { focused?: boolean; selected?: boolean; messages?: number } };
        exceptionDetails?: { exception?: { description?: string } };
      };
      if (focused.exceptionDetails) {
        throw new Error(
          focused.exceptionDetails.exception?.description || "Codex input not found.",
        );
      }
      if (!focused.result?.value?.focused) {
        throw new Error("Codex input could not be focused.");
      }
      if (!focused.result.value.selected) {
        throw new Error("Codex input content could not be selected.");
      }
      await cdp("Input.insertText", {
        text: input.message,
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
          const sent = () => (
            doc.querySelectorAll('[data-user-message-bubble="true"]').length
            > ${focused.result.value.messages ?? 0}
          );
          if (sent()) return resolve(true);
          const observer = new MutationObserver(() => {
            if (!sent()) return;
            clearTimeout(timeout);
            observer.disconnect();
            resolve(true);
          });
          const timeout = setTimeout(() => {
            observer.disconnect();
            resolve(false);
          }, 1_500);
          observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
        })`,
        awaitPromise: true,
        returnByValue: true,
      }) as { result?: { value?: boolean } };
      if (!verification.result?.value) {
        throw new Error("Codex user message did not appear within 1.5 seconds after Enter.");
      }
    } catch (error) {
      throw new Error(
        `Cannot send to "${input.workspacePath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    } finally {
      socket.close();
    }
    return `Message sent to "${input.workspacePath}" through "${contact.page.title}".`;
  }

  private async target(
    workspacePath: string,
    remoteDebuggingPort?: number,
  ): Promise<Contact> {
    const key = resolve(workspacePath).toLocaleLowerCase();
    const cachedPort = this.ports.get(key);
    let ports = remoteDebuggingPort
      ? [remoteDebuggingPort]
      : cachedPort === undefined
        ? []
        : [cachedPort];
    if (ports.length === 0) {
      if (process.platform !== "win32") {
        throw new Error("自动发现 VS Code 调试端口目前只支持 Windows。");
      }
      const { stdout } = await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          [
            "Get-CimInstance Win32_Process -Filter \"Name = 'Code.exe'\"",
            "Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch '\\\\extends-hono\\\\ai-contact\\\\' }",
            "ForEach-Object { if ($_.CommandLine -match '--remote-debugging-port(?:=|\\s+)(\\d+)') { $Matches[1] } }",
            "Sort-Object -Unique",
          ].join(" | "),
        ],
        { timeout: 3_000, windowsHide: true },
      );
      ports = stdout
        .split(/\r?\n/)
        .map(value => Number(value.trim()))
        .filter(port => Number.isInteger(port) && port > 0 && port <= 65_535);
    }
    const probeErrors: Error[] = [];
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (!response.ok) {
          probeErrors.push(new Error(
            `Cannot inspect VS Code debugging port ${port}: HTTP ${response.status}.`,
          ));
          continue;
        }
        const targets = await response.json() as DebugTarget[];
        const workspaceName = basename(workspacePath);
        const pages = targets.filter(target => (
          target.type === "page"
          && target.title.toLocaleLowerCase().includes(workspaceName.toLocaleLowerCase())
        ));
        const page = pages[0];
        if (pages.length !== 1 || !page?.webSocketDebuggerUrl) continue;
        const webviews = targets.filter(target => (
          target.type === "iframe"
          && target.parentId === page.id
          && new URL(target.url).searchParams.get("extensionId") === "openai.chatgpt"
        ));
        const webview = webviews[0];
        if (webviews.length !== 1 || !webview?.webSocketDebuggerUrl) continue;
        const contact = {
          workspacePath,
          remoteDebuggingPort: port,
          page: { ...page, webSocketDebuggerUrl: page.webSocketDebuggerUrl },
          webview: { ...webview, webSocketDebuggerUrl: webview.webSocketDebuggerUrl },
        };
        this.ports.set(key, port);
        return contact;
      } catch (error) {
        this.ports.delete(key);
        probeErrors.push(new Error(
          `Cannot inspect VS Code debugging port ${port}.`,
          { cause: error },
        ));
      }
    }
    const targetError = new Error(
      `未发现 ${workspacePath} 当前已运行且启用远程调试的 VS Code Codex 窗口。`,
    );
    if (probeErrors.length) {
      throw new AggregateError([targetError, ...probeErrors], targetError.message);
    }
    throw targetError;
  }
}

export default new WORKSPACE_AI_CONTACT();

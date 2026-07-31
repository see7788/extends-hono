import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type DevToolsTarget = {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type WebViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RemoteFrameMetadata = {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
};

type RemoteFrame = {
  bounds: WebViewBounds;
  data: string;
  metadata: RemoteFrameMetadata;
};

type RemoteEvent =
  | { type: "frame"; frame: RemoteFrame }
  | { type: "status"; message: string }
  | { type: "error"; message: string };

type RemoteEventListener = (event: RemoteEvent) => void;

type CdpResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

type CdpWaiter = {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
};

export type RemoteAction =
  | {
      type: "mouse";
      eventType: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
      x: number;
      y: number;
      button?: "none" | "left" | "middle" | "right";
      buttons?: number;
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      type: "key";
      eventType: "rawKeyDown" | "keyUp";
      key: string;
      code: string;
      modifiers?: number;
      windowsVirtualKeyCode?: number;
    }
  | { type: "text"; text: string };

const webViewBoundsExpression = `(() => {
  const frames = Array.from(document.querySelectorAll("iframe.webview"))
    .filter((frame) => frame.src.includes("extensionId=openai.chatgpt"))
    .filter((frame) => {
      const rect = frame.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  if (frames.length !== 1) {
    throw new Error("需要唯一可见的 Codex WebView，当前数量：" + frames.length);
  }
  const rect = frames[0].getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`;

class RemoteWeb {
  private readonly workspacePath: string;
  private socket: WebSocket | undefined;
  private connectionPromise: Promise<void> | undefined;
  private requestId = 0;
  private readonly waiters = new Map<number, CdpWaiter>();
  private readonly listeners = new Set<RemoteEventListener>();
  private bounds: WebViewBounds | undefined;
  private boundsReadAt = 0;
  private captureTimer: NodeJS.Timeout | undefined;
  private capturing = false;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async view(listener: RemoteEventListener) {
    this.listeners.add(listener);
    try {
      await this.connectionOpen();
      this.captureStart();
      listener({ type: "status", message: "已连接当前工作区的 Codex WebView" });
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.captureStop();
        this.connectionClose();
      }
    };
  }

  async action(action: RemoteAction) {
    await this.connectionOpen();
    try {
      if (action.type === "text") {
        await this.request("Input.insertText", { text: action.text });
        return;
      }
      if (action.type === "key") {
        await this.request("Input.dispatchKeyEvent", {
          type: action.eventType,
          key: action.key,
          code: action.code,
          modifiers: action.modifiers ?? 0,
          windowsVirtualKeyCode: action.windowsVirtualKeyCode ?? 0,
          nativeVirtualKeyCode: action.windowsVirtualKeyCode ?? 0,
        });
        return;
      }
      const bounds = await this.boundsRead();
      await this.request("Input.dispatchMouseEvent", {
        type: action.eventType,
        x: bounds.x + action.x,
        y: bounds.y + action.y,
        button: action.button ?? "none",
        buttons: action.buttons ?? 0,
        clickCount: action.clickCount ?? 0,
        deltaX: action.deltaX ?? 0,
        deltaY: action.deltaY ?? 0,
        modifiers: action.modifiers ?? 0,
        pointerType: "mouse",
      });
    } finally {
      if (this.listeners.size === 0) this.connectionClose();
    }
  }

  private async connectionOpen() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.connectionCreate().finally(() => {
      this.connectionPromise = undefined;
    });
    return this.connectionPromise;
  }

  private async connectionCreate() {
    const target = await this.targetFind();
    const socket = new WebSocket(target.webSocketDebuggerUrl!);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      socket.addEventListener("open", () => resolvePromise(), { once: true });
      socket.addEventListener("error", () => rejectPromise(new Error("无法连接 VS Code 调试目标")), {
        once: true,
      });
    });
    this.socket = socket;
    socket.addEventListener("message", (event) => this.messageReceive(String(event.data)));
    socket.addEventListener("close", () => this.connectionLost(new Error("VS Code 调试连接已关闭")), {
      once: true,
    });
    socket.addEventListener("error", () => this.connectionLost(new Error("VS Code 调试连接发生错误")), {
      once: true,
    });
    this.bounds = await this.boundsRead(true);
  }

  private connectionClose() {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.close();
    this.waitersReject(new Error("远程页面已断开"));
  }

  private connectionLost(error: Error) {
    if (!this.socket) return;
    this.socket = undefined;
    this.captureStop();
    this.waitersReject(error);
    this.publish({ type: "error", message: error.message });
  }

  private async targetFind() {
    const ports = await this.debuggingPorts();
    const workspaceName = basename(this.workspacePath).toLowerCase();
    const matches: DevToolsTarget[] = [];
    const probeErrors: Error[] = [];
    for (const port of ports) {
      let targets: DevToolsTarget[];
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!response.ok) {
          probeErrors.push(new Error(
            `Cannot inspect VS Code debugging port ${port}: HTTP ${response.status}.`,
          ));
          continue;
        }
        targets = (await response.json()) as DevToolsTarget[];
      } catch (error) {
        probeErrors.push(new Error(
          `Cannot inspect VS Code debugging port ${port}.`,
          { cause: error },
        ));
        continue;
      }
      matches.push(...targets.filter((target) =>
        target.type === "page"
        && Boolean(target.webSocketDebuggerUrl)
        && target.title.trim().toLowerCase() === workspaceName
      ));
    }
    if (matches.length !== 1) {
      const targetError = new Error(
        `需要唯一的 ${basename(this.workspacePath)} VS Code 调试窗口，当前数量：${matches.length}`,
      );
      if (probeErrors.length) {
        throw new AggregateError([targetError, ...probeErrors], targetError.message);
      }
      throw targetError;
    }
    return matches[0];
  }

  private async debuggingPorts() {
    const [{ stdout: processOutput }, { stdout: networkOutput }] = await Promise.all([
      execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "(Get-Process -Name Code -ErrorAction SilentlyContinue).Id",
      ], { windowsHide: true }),
      execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], { windowsHide: true }),
    ]);
    const processIds = new Set(
      processOutput.split(/\r?\n/)
        .map((value) => Number(value.trim()))
        .filter(Number.isInteger),
    );
    const ports = new Set<number>();
    for (const line of networkOutput.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[3] !== "LISTENING") continue;
      const processId = Number(columns[4]);
      if (!processIds.has(processId)) continue;
      const address = columns[1];
      const port = Number(address.slice(address.lastIndexOf(":") + 1));
      if (Number.isInteger(port)) ports.add(port);
    }
    if (ports.size === 0) {
      throw new Error("没有发现 VS Code 正在监听的本机调试端口");
    }
    return [...ports];
  }

  private async boundsRead(force = false) {
    if (!force && this.bounds && Date.now() - this.boundsReadAt < 1000) return this.bounds;
    const result = await this.request("Runtime.evaluate", {
      expression: webViewBoundsExpression,
      returnByValue: true,
      awaitPromise: true,
    });
    const remoteObject = result.result as { value?: WebViewBounds; description?: string } | undefined;
    if (!remoteObject?.value) {
      throw new Error(remoteObject?.description ?? "无法取得 Codex WebView 边界");
    }
    this.bounds = remoteObject.value;
    this.boundsReadAt = Date.now();
    return this.bounds;
  }

  private messageReceive(json: string) {
    const message = JSON.parse(json) as CdpResponse;
    if (message.id !== undefined) {
      const waiter = this.waiters.get(message.id);
      if (!waiter) return;
      this.waiters.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? {});
    }
  }

  private captureStart() {
    if (this.capturing) return;
    this.capturing = true;
    this.frameCapture();
  }

  private captureStop() {
    this.capturing = false;
    clearTimeout(this.captureTimer);
    this.captureTimer = undefined;
  }

  private async frameCapture() {
    const startedAt = Date.now();
    try {
      const bounds = await this.boundsRead();
      const result = await this.request("Page.captureScreenshot", {
        format: "jpeg",
        quality: 65,
        fromSurface: true,
        captureBeyondViewport: false,
        clip: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          scale: 1,
        },
      });
      const data = String(result.data);
      const frameBounds = { x: 0, y: 0, width: bounds.width, height: bounds.height };
      const metadata: RemoteFrameMetadata = {
        deviceWidth: bounds.width,
        deviceHeight: bounds.height,
        pageScaleFactor: 1,
      };
      this.publish({ type: "frame", frame: { data, metadata, bounds: frameBounds } });
    } catch (error) {
      this.captureStop();
      this.publish({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!this.capturing) return;
    const delay = Math.max(0, 125 - (Date.now() - startedAt));
    this.captureTimer = setTimeout(() => this.frameCapture(), delay);
  }

  private publish(event: RemoteEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private request(method: string, params: Record<string, unknown> = {}) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("VS Code 调试连接不可用"));
    }
    return this.requestWithSocket(socket, method, params);
  }

  private requestWithSocket(
    socket: WebSocket,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    const id = ++this.requestId;
    return new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(id);
        rejectPromise(new Error(`CDP 请求超时：${method}`));
      }, 5000);
      this.waiters.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectPromise(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private waitersReject(error: Error) {
    for (const waiter of this.waiters.values()) waiter.reject(error);
    this.waiters.clear();
  }
}

export default new RemoteWeb(new URL("../../..", import.meta.url).pathname.slice(1).replaceAll("/", "\\"));

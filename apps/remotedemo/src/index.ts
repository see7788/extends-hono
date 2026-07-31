import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import remoteWeb, { type RemoteAction } from "./RemoteWeb.ts";

const app = new Hono();

app.get("/", (context) => context.redirect("/remote"));

app.get("/remote", (context) => context.html(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Remote Web</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: auto; background: #010409; }
    main { width: max-content; height: max-content; min-width: 100%; min-height: 100%; }
    #screen {
      display: block; max-width: none; max-height: none;
      background: #010409; border: 0; outline: none; cursor: default;
    }
    #keyboard {
      position: fixed; width: 1px; height: 1px; left: 0; top: 0;
      opacity: 0; pointer-events: none;
    }
  </style>
</head>
<body>
  <main><canvas id="screen" tabindex="0"></canvas></main>
  <textarea id="keyboard" aria-label="远程键盘输入"></textarea>
  <script>
    const screen = document.getElementById("screen");
    const keyboard = document.getElementById("keyboard");
    const context = screen.getContext("2d");
    let bounds;
    let composing = false;
    let frameDrawing = false;
    let frameQueued;
    let mouseMovePending = false;

    const errorThrow = (error) => queueMicrotask(() => {
      throw error instanceof Error ? error : new Error(String(error));
    });

    const modifiers = (event) =>
      (event.altKey ? 1 : 0)
      | (event.ctrlKey ? 2 : 0)
      | (event.metaKey ? 4 : 0)
      | (event.shiftKey ? 8 : 0);

    const button = (value) => ["left", "middle", "right"][value] ?? "none";

    const point = (event) => {
      const rect = screen.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width * bounds.width,
        y: (event.clientY - rect.top) / rect.height * bounds.height,
      };
    };

    const action = (payload) => fetch("/remote/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
    }).catch(errorThrow);

    const frameDraw = (frame) => {
      frameQueued = frame;
      if (frameDrawing) return;
      frameDrawing = true;
      const { data, metadata, bounds: nextBounds } = frameQueued;
      frameQueued = undefined;
      const image = new Image();
      image.onload = () => {
        const scaleX = image.naturalWidth / metadata.deviceWidth;
        const scaleY = image.naturalHeight / metadata.deviceHeight;
        const sourceX = nextBounds.x * scaleX;
        const sourceY = nextBounds.y * scaleY;
        const sourceWidth = nextBounds.width * scaleX;
        const sourceHeight = nextBounds.height * scaleY;
        screen.width = Math.max(1, Math.round(sourceWidth));
        screen.height = Math.max(1, Math.round(sourceHeight));
        context.drawImage(
          image,
          sourceX, sourceY, sourceWidth, sourceHeight,
          0, 0, screen.width, screen.height,
        );
        bounds = nextBounds;
        screen.style.width = nextBounds.width + "px";
        screen.style.height = nextBounds.height + "px";
        frameDrawing = false;
        if (frameQueued) frameDraw(frameQueued);
      };
      image.onerror = (error) => {
        frameDrawing = false;
        if (frameQueued) frameDraw(frameQueued);
        errorThrow(error);
      };
      image.src = "data:image/jpeg;base64," + data;
    };

    const events = new EventSource("/remote/events");
    events.addEventListener("frame", (event) => frameDraw(JSON.parse(event.data)));
    events.addEventListener("remote-error", (event) => {
      throw new Error(event.data);
    });
    events.onerror = () => {
      throw new Error("连接中断，正在重连");
    };

    screen.addEventListener("pointerdown", (event) => {
      if (!bounds) return;
      event.preventDefault();
      screen.setPointerCapture(event.pointerId);
      keyboard.style.left = event.clientX + "px";
      keyboard.style.top = event.clientY + "px";
      keyboard.focus({ preventScroll: true });
      action({
        type: "mouse", eventType: "mousePressed", ...point(event),
        button: button(event.button), buttons: event.buttons,
        clickCount: event.detail || 1, modifiers: modifiers(event),
      });
    });
    screen.addEventListener("pointerup", (event) => {
      if (!bounds) return;
      event.preventDefault();
      action({
        type: "mouse", eventType: "mouseReleased", ...point(event),
        button: button(event.button), buttons: event.buttons,
        clickCount: event.detail || 1, modifiers: modifiers(event),
      });
    });
    screen.addEventListener("pointermove", (event) => {
      if (!bounds || mouseMovePending) return;
      mouseMovePending = true;
      const payload = {
        type: "mouse", eventType: "mouseMoved", ...point(event),
        button: "none", buttons: event.buttons, modifiers: modifiers(event),
      };
      setTimeout(() => {
        mouseMovePending = false;
        action(payload);
      }, 50);
    });
    screen.addEventListener("wheel", (event) => {
      if (!bounds) return;
      event.preventDefault();
      action({
        type: "mouse", eventType: "mouseWheel", ...point(event),
        deltaX: event.deltaX, deltaY: event.deltaY,
        buttons: event.buttons, modifiers: modifiers(event),
      });
    }, { passive: false });
    screen.addEventListener("contextmenu", (event) => event.preventDefault());

    keyboard.addEventListener("input", () => {
      if (composing) return;
      if (!keyboard.value) return;
      action({ type: "text", text: keyboard.value });
      keyboard.value = "";
    });
    keyboard.addEventListener("compositionstart", () => {
      composing = true;
    });
    keyboard.addEventListener("compositionend", (event) => {
      composing = false;
      const text = keyboard.value || event.data;
      keyboard.value = "";
      if (text) action({ type: "text", text });
    });
    keyboard.addEventListener("keydown", (event) => {
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable || event.isComposing) return;
      event.preventDefault();
      action({
        type: "key", eventType: "rawKeyDown", key: event.key, code: event.code,
        modifiers: modifiers(event), windowsVirtualKeyCode: event.keyCode,
      });
    });
    keyboard.addEventListener("keyup", (event) => {
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable || event.isComposing) return;
      event.preventDefault();
      action({
        type: "key", eventType: "keyUp", key: event.key, code: event.code,
        modifiers: modifiers(event), windowsVirtualKeyCode: event.keyCode,
      });
    });
  </script>
</body>
</html>`));

app.get("/remote/events", (context) => streamSSE(context, async (stream) => {
  let active = true;
  let writeError: Error | undefined;
  let writes = Promise.resolve();
  let close = () => {};
  close = await remoteWeb.view((event) => {
    if (!active) return;
    const name = event.type === "error" ? "remote-error" : event.type;
    const data = event.type === "frame" ? JSON.stringify(event.frame) : event.message;
    writes = writes
      .then(() => stream.writeSSE({ event: name, data }))
      .catch(error => {
        writeError = error instanceof Error ? error : new Error(String(error));
        active = false;
        close();
      });
  });
  stream.onAbort(() => {
    active = false;
    close();
  });
  while (active) await stream.sleep(1000);
  await writes;
  if (writeError) throw writeError;
}));

app.post("/remote/action", async (context) => {
  const action = await context.req.json<RemoteAction>();
  await remoteWeb.action(action);
  return context.json({ ok: true });
});

app.onError((error, context) => context.text(error.message, 500));

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: 3010,
}, (info) => {
  console.log(`Remote demo: http://127.0.0.1:${info.port}/remote`);
});

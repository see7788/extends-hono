import { serve } from "@hono/node-server";
import ubuntu from "extends-ssh/src/Ubuntu.ts";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";

const privateCloud = ubuntu.webrtcProxyState;
const hostname = "127.0.0.1";
const port = 32223;
const app = new Hono();
const remoteScript = await readFile(
  new URL("../dist/remote.js", import.meta.url),
  "utf8",
);

const signalingProtocol = privateCloud.peerServer.secure ? "wss" : "ws";
const stunProtocol = privateCloud.stunServer.secure ? "stuns" : "stun";
const configuration = {
  signalingUrl: `${signalingProtocol}://${privateCloud.peerServer.host}:${privateCloud.peerServer.port}${privateCloud.peerServer.path}`,
  iceServers: [{
    urls: `${stunProtocol}:${privateCloud.stunServer.host}:${privateCloud.stunServer.port}`,
  }],
  controlBaseUrl: `http://${hostname}:${port}/`,
};

const controllerHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Remote demo 2</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: auto; background: #000; }
    video { display: block; max-width: none; max-height: none; outline: none; background: #000; }
    textarea {
      position: fixed; width: 1px; height: 1px; left: 0; top: 0;
      padding: 0; border: 0; opacity: 0; pointer-events: none;
    }
  </style>
</head>
<body>
  <video id="screen" autoplay playsinline tabindex="0"></video>
  <textarea id="keyboard" aria-label="远程键盘输入"></textarea>
  <script>
    const configuration = ${JSON.stringify(configuration)};
    const sourceId = new URL(location.href).searchParams.get("source");
    if (!sourceId || !/^[A-Za-z0-9_-]+$/.test(sourceId)) {
      throw new Error("控制地址缺少有效的 source");
    }

    const randomId = (prefix) => {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      return prefix + Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    };
    const peerId = randomId("controller_");
    const connectionId = randomId("connection_");
    const signaling = new WebSocket(
      configuration.signalingUrl + "?peerId=" + encodeURIComponent(peerId),
    );
    const connection = new RTCPeerConnection({
      iceServers: configuration.iceServers,
    });
    const control = connection.createDataChannel("control", { ordered: true });
    const screen = document.getElementById("screen");
    const keyboard = document.getElementById("keyboard");
    const candidates = [];
    let remoteDescriptionSet = false;
    let composing = false;
    let pointerMovePending = false;

    const errorThrow = (error) => queueMicrotask(() => {
      throw error instanceof Error ? error : new Error(String(error));
    });
    const connectionFail = (error) => {
      connection.close();
      signaling.close();
      errorThrow(error);
    };

    const signalSend = (signal) => {
      if (signaling.readyState !== WebSocket.OPEN) {
        throw new Error("信令连接尚未打开");
      }
      signaling.send(JSON.stringify({
        ...signal,
        to: sourceId,
        connectionId,
      }));
    };
    const controlSend = (message) => {
      if (control.readyState !== "open") {
        throw new Error("远程控制连接尚未打开");
      }
      control.send(JSON.stringify(message));
    };
    const modifiers = (event) => ({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    const point = (event) => {
      const rect = screen.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    };

    connection.addTransceiver("video", { direction: "recvonly" });
    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        signalSend({ type: "candidate", candidate: event.candidate.toJSON() });
      }
    });
    connection.addEventListener("track", (event) => {
      screen.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    });
    screen.addEventListener("loadedmetadata", () => {
      screen.style.width = screen.videoWidth + "px";
      screen.style.height = screen.videoHeight + "px";
    });

    const signalReceive = async (event) => {
      const signal = JSON.parse(event.data);
      if (signal.type === "open") {
        const description = await connection.createOffer();
        await connection.setLocalDescription(description);
        signalSend({ type: "offer", description });
        return;
      }
      if (signal.connectionId !== connectionId) return;
      if (signal.type === "answer") {
        await connection.setRemoteDescription(signal.description);
        remoteDescriptionSet = true;
        while (candidates.length) {
          await connection.addIceCandidate(candidates.shift());
        }
        return;
      }
      if (signal.type === "candidate") {
        if (remoteDescriptionSet) {
          await connection.addIceCandidate(signal.candidate);
        } else {
          candidates.push(signal.candidate);
        }
        return;
      }
      if (signal.type === "error") {
        throw new Error(signal.message);
      }
    };
    signaling.addEventListener("message", (event) => {
      signalReceive(event).catch(connectionFail);
    });
    signaling.addEventListener("error", () => {
      connectionFail(new Error("WebRTC 信令连接失败"));
    });

    screen.addEventListener("pointerdown", (event) => {
      if (!screen.videoWidth) return;
      event.preventDefault();
      screen.setPointerCapture(event.pointerId);
      keyboard.style.left = event.clientX + "px";
      keyboard.style.top = event.clientY + "px";
      keyboard.focus({ preventScroll: true });
      controlSend({
        type: "pointer", eventType: "pointerdown", ...point(event),
        button: event.button, buttons: event.buttons, ...modifiers(event),
      });
    });
    screen.addEventListener("pointerup", (event) => {
      if (!screen.videoWidth) return;
      event.preventDefault();
      controlSend({
        type: "pointer", eventType: "pointerup", ...point(event),
        button: event.button, buttons: event.buttons, ...modifiers(event),
      });
    });
    screen.addEventListener("pointermove", (event) => {
      if (!screen.videoWidth || pointerMovePending) return;
      pointerMovePending = true;
      const message = {
        type: "pointer", eventType: "pointermove", ...point(event),
        button: event.button, buttons: event.buttons, ...modifiers(event),
      };
      setTimeout(() => {
        pointerMovePending = false;
        controlSend(message);
      }, 40);
    });
    screen.addEventListener("wheel", (event) => {
      if (!screen.videoWidth) return;
      event.preventDefault();
      controlSend({
        type: "wheel", ...point(event),
        deltaX: event.deltaX, deltaY: event.deltaY,
        ...modifiers(event),
      });
    }, { passive: false });
    screen.addEventListener("contextmenu", event => event.preventDefault());

    keyboard.addEventListener("compositionstart", () => {
      composing = true;
    });
    keyboard.addEventListener("compositionend", (event) => {
      composing = false;
      const text = keyboard.value || event.data;
      keyboard.value = "";
      if (text) controlSend({ type: "text", text });
    });
    keyboard.addEventListener("input", () => {
      if (composing || !keyboard.value) return;
      controlSend({ type: "text", text: keyboard.value });
      keyboard.value = "";
    });
    keyboard.addEventListener("keydown", (event) => {
      const printable = event.key.length === 1
        && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable || event.isComposing) return;
      event.preventDefault();
      controlSend({
        type: "key", eventType: "keydown",
        key: event.key, code: event.code, ...modifiers(event),
      });
    });
    keyboard.addEventListener("keyup", (event) => {
      const printable = event.key.length === 1
        && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable || event.isComposing) return;
      event.preventDefault();
      controlSend({
        type: "key", eventType: "keyup",
        key: event.key, code: event.code, ...modifiers(event),
      });
    });
  </script>
</body>
</html>`;

app.get("/", (context) => context.html(controllerHtml));

app.get("/remote.js", (context) => {
  context.header("access-control-allow-origin", "*");
  context.header("content-type", "text/javascript; charset=UTF-8");
  return context.body(remoteScript);
});

app.onError((error, context) => context.text(error.message, 500));

serve({
  fetch: app.fetch,
  hostname,
  port,
}, (info) => {
  console.log(`Remote demo 2: http://${hostname}:${info.port}/`);
  console.log(`Console script: http://${hostname}:${info.port}/remote.js`);
});

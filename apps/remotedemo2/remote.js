(() => {
  const configuration = __REMOTE_DEMO2_CONFIGURATION__;
  const current = globalThis.__REMOTE_DEMO2__;
  if (current) {
    current.close();
  }

  const randomId = (prefix) => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return prefix + Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  };
  const sourceId = randomId("source_");
  const connections = new Map();
  const signaling = new WebSocket(
    configuration.signalingUrl + "?peerId=" + encodeURIComponent(sourceId),
  );
  let stream;
  let activeElement;

  const pointRead = (message) => ({
    x: message.x * window.innerWidth,
    y: message.y * window.innerHeight,
  });

  const inputText = (text) => {
    const target = activeElement instanceof HTMLElement
      ? activeElement
      : document.activeElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.setRangeText(text, start, end, "end");
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }));
      return;
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      target.focus();
      document.execCommand("insertText", false, text);
    }
  };

  const inputKey = (message) => {
    const target = activeElement instanceof HTMLElement
      ? activeElement
      : document.activeElement;
    if (!(target instanceof HTMLElement)) return;
    target.dispatchEvent(new KeyboardEvent(message.eventType, {
      key: message.key,
      code: message.code,
      bubbles: true,
      cancelable: true,
      altKey: message.altKey,
      ctrlKey: message.ctrlKey,
      metaKey: message.metaKey,
      shiftKey: message.shiftKey,
    }));
    if (message.eventType !== "keydown") return;
    if (message.key === "Backspace") {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        const from = start === end ? Math.max(0, start - 1) : start;
        target.setRangeText("", from, end, "end");
        target.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
        }));
      } else if (target.isContentEditable) {
        document.execCommand("delete");
      }
    }
    if (message.key === "Enter") {
      if (target instanceof HTMLTextAreaElement || target.isContentEditable) {
        inputText("\n");
      } else if (target instanceof HTMLInputElement) {
        target.form?.requestSubmit();
      }
    }
  };

  const controlReceive = (message) => {
    if (message.type === "text") {
      inputText(message.text);
      return;
    }
    if (message.type === "key") {
      inputKey(message);
      return;
    }
    const point = pointRead(message);
    const target = document.elementFromPoint(point.x, point.y) ?? document.body;
    if (message.type === "wheel") {
      target.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaX: message.deltaX,
        deltaY: message.deltaY,
        altKey: message.altKey,
        ctrlKey: message.ctrlKey,
        metaKey: message.metaKey,
        shiftKey: message.shiftKey,
      }));
      window.scrollBy(message.deltaX, message.deltaY);
      return;
    }
    if (message.type !== "pointer") return;
    if (message.eventType === "pointerdown" && target instanceof HTMLElement) {
      activeElement = target;
      target.focus({ preventScroll: true });
    }
    target.dispatchEvent(new PointerEvent(message.eventType, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: message.button,
      buttons: message.buttons,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      altKey: message.altKey,
      ctrlKey: message.ctrlKey,
      metaKey: message.metaKey,
      shiftKey: message.shiftKey,
    }));
    const mouseType = {
      pointerdown: "mousedown",
      pointerup: "mouseup",
      pointermove: "mousemove",
    }[message.eventType];
    target.dispatchEvent(new MouseEvent(mouseType, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: message.button,
      buttons: message.buttons,
      altKey: message.altKey,
      ctrlKey: message.ctrlKey,
      metaKey: message.metaKey,
      shiftKey: message.shiftKey,
    }));
    if (message.eventType === "pointerup" && message.button === 0) {
      target.click();
    }
  };

  const signalSend = (signal) => {
    if (signaling.readyState !== WebSocket.OPEN) {
      throw new Error("信令连接尚未打开");
    }
    signaling.send(JSON.stringify(signal));
  };

  const connectionClose = (connectionId) => {
    const state = connections.get(connectionId);
    if (!state) return;
    state.connection.close();
    connections.delete(connectionId);
  };

  const offerReceive = async (signal) => {
    connectionClose(signal.connectionId);
    const connection = new RTCPeerConnection({
      iceServers: configuration.iceServers,
    });
    const state = {
      peerId: signal.from,
      connection,
      candidates: [],
      remoteDescriptionSet: false,
    };
    connections.set(signal.connectionId, state);
    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }
    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        signalSend({
          type: "candidate",
          to: signal.from,
          connectionId: signal.connectionId,
          candidate: event.candidate.toJSON(),
        });
      }
    });
    connection.addEventListener("datachannel", (event) => {
      if (event.channel.label !== "control") return;
      event.channel.addEventListener("message", (messageEvent) => {
        try {
          controlReceive(JSON.parse(messageEvent.data));
        } catch (error) {
          console.error("远程控制消息执行失败", error);
        }
      });
    });
    await connection.setRemoteDescription(signal.description);
    state.remoteDescriptionSet = true;
    while (state.candidates.length) {
      await connection.addIceCandidate(state.candidates.shift());
    }
    const description = await connection.createAnswer();
    await connection.setLocalDescription(description);
    signalSend({
      type: "answer",
      to: signal.from,
      connectionId: signal.connectionId,
      description,
    });
  };

  signaling.addEventListener("message", async (event) => {
    const signal = JSON.parse(event.data);
    if (signal.type === "offer") {
      await offerReceive(signal);
      return;
    }
    if (signal.type === "candidate") {
      const state = connections.get(signal.connectionId);
      if (!state) return;
      if (state.remoteDescriptionSet) {
        await state.connection.addIceCandidate(signal.candidate);
      } else {
        state.candidates.push(signal.candidate);
      }
      return;
    }
    if (signal.type === "peer-close") {
      for (const [connectionId, state] of connections) {
        if (state.peerId === signal.peerId) connectionClose(connectionId);
      }
      return;
    }
    if (signal.type === "error") {
      console.error("WebRTC 信令错误", signal.message);
    }
  });
  signaling.addEventListener("error", () => {
    console.error("WebRTC 信令连接失败");
  });

  const button = document.createElement("button");
  button.textContent = "开始远程协助";
  button.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "padding:10px 14px",
    "border:0",
    "border-radius:8px",
    "background:#1677ff",
    "color:#fff",
    "font:14px system-ui,sans-serif",
    "cursor:pointer",
  ].join(";");
  button.addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 20 },
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
      });
      button.remove();
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        globalThis.__REMOTE_DEMO2__?.close();
      });
      const controlUrl = configuration.controlBaseUrl
        + "?source=" + encodeURIComponent(sourceId);
      try {
        await navigator.clipboard.writeText(controlUrl);
      } catch {}
      console.log("远程控制地址（已尝试复制）:", controlUrl);
      prompt("把这个控制地址交给协助者", controlUrl);
    } catch (error) {
      console.error("开始远程协助失败", error);
    }
  }, { once: true });
  document.documentElement.appendChild(button);

  globalThis.__REMOTE_DEMO2__ = {
    close() {
      button.remove();
      for (const connectionId of [...connections.keys()]) {
        connectionClose(connectionId);
      }
      stream?.getTracks().forEach(track => track.stop());
      signaling.close();
      delete globalThis.__REMOTE_DEMO2__;
    },
  };
})();

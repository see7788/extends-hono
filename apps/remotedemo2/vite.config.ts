import ubuntu from "extends-ssh/Ubuntu/index.ts";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const privateCloud = ubuntu.webrtcProxy.state;
const hostname = "127.0.0.1";
const port = 32223;
const signalingProtocol = privateCloud.peerServer.secure ? "wss" : "ws";
const stunProtocol = privateCloud.stunServer.secure ? "stuns" : "stun";

export default defineConfig({
  define: {
    __REMOTE_DEMO2_CONFIGURATION__: JSON.stringify({
      signalingUrl: `${signalingProtocol}://${privateCloud.peerServer.host}:${privateCloud.peerServer.port}${privateCloud.peerServer.path}`,
      iceServers: [{
        urls: `${stunProtocol}:${privateCloud.stunServer.host}:${privateCloud.stunServer.port}`,
      }],
      controlBaseUrl: `http://${hostname}:${port}/`,
    }),
  },
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/remote.js"),
      formats: ["iife"],
      name: "RemoteDemo2",
      fileName: () => "remote.js",
    },
  },
});

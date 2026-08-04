import { defineConfig } from "vite";
import honoReact from "vite-config-lib/plugin.ts";

export default defineConfig({
  plugins: [
    honoReact({
      honoEntry: "src/index.ts",
      honoHost: "127.0.0.1",
      honoPort: [3005, 3111],
    }, ["../../libs/todotree"]),
  ],
});

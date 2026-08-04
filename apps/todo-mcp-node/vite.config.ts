import { defineConfig } from "vite";
import honoReact from "vite-config-lib/plugin2.ts";

export default defineConfig({
  plugins: [
    honoReact({
      honoEntry: "src/routers.ts",
      nodeEntry: "src/index.ts",
      honoHost: "127.0.0.1",
      honoPort: 3005,
    }, ["../../libs/todotree"]),
  ],
});

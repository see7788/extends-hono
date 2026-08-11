import { defineConfig } from "vite";
import honoReact from "vite-config-lib/plugin2";

export default defineConfig({
  plugins: [
    honoReact({
      hono: {
        path: "./src/routers.ts",
        port: 3005,
        define: {},
      },
      renderer: [{}, "../../libs/todotree"],
    }),
  ],
});

import react from "@vitejs/plugin-react";
import ubuntu from "ubuntu-lib/index.ts";
import { defineConfig } from "vite";
import honoReact from "vite-config-lib/plugin2";

export default defineConfig({
  plugins: [
    react(),
    honoReact({
      hono: {
        path: "./src/index.ts",
        port: [3000, 3001],
      },
      renderer: {
        paths: ["../__PACKAGE_NAME__-renderer/src/index.tsx"],
      },
    }),
    ubuntu.vite.dev.forward(),
    ubuntu.vite.pro.nodejs(),
  ],
});

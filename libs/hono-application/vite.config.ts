import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import honoReact from "hono-vite-config/plugin";

export default defineConfig({
  plugins: [
    react(),
    honoReact({
      hono: {
        path: "./src/index.ts",
        port: [3000, 3001],
        define: {
          APP_HEALTH_PATH: "/health",
        },
      },
      renderer: {
        paths: ["../__PACKAGE_NAME__-renderer/src/index.tsx"],
      },
    }),
  ],
});

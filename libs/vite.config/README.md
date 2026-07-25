# vite.config

Run one Hono entry and one or more React Vite projects from the normal Vite command. Development HTTP stays on the Hono address while Vite owns the internal development servers and HMR WebSockets. Production builds to `dist/<package.name>`.

```ts
import viteConfig from "vite.config/vite";

export default viteConfig(
  {
    honoEntry: "src/index.ts",
    honoHost: "127.0.0.1",
    honoPort: 3005,
  },
  "../reactapp",
);
```

The plugin form provides the same behavior when it needs to compose with another Vite configuration:

```ts
import { defineConfig } from "vite";
import honoReact from "vite.config/plugin";

export default defineConfig({
  plugins: [
    honoReact(
      {
        honoEntry: "src/index.ts",
        honoHost: "127.0.0.1",
        honoPort: 3005,
      },
      "../reactapp",
    ),
  ],
});
```

## React project configuration

Every React path is relative to `process.cwd()` and must contain its own `package.json` and `vite.config.ts`. This package does not install or register `@vitejs/plugin-react`; each React project owns its complete Vite configuration:

```ts
// ../reactapp/vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
});
```

The React project may instead use `@vitejs/plugin-react-swc` or add its own aliases, CSS options, and Vite plugins. Both development servers and production builds load the same project configuration.

During development, the first React project uses the Vite command's server, additional projects use managed Vite servers, and the Hono entry runs through `tsx`. During production, every React project is written to `dist/<package.name>` and the Hono entry is built separately.

The Hono entry uses the matching server function:

```ts
import honoServer from "vite.config/honoServer";

const server = honoServer({ fetch: app.fetch, hostname, port });
injectWebSocket(server);
```

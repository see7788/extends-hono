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

The Hono entry uses the matching server function:

```ts
import honoServer from "vite.config/honoServer";

const server = honoServer({ fetch: app.fetch, hostname, port });
injectWebSocket(server);
```

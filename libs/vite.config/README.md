# vite.config

使用普通 Vite 命令同时运行一个 Hono 入口和一个或多个 React Vite 项目。开发期间，对外 HTTP 地址始终使用 Hono 端口，内部 React 开发服务和 HMR WebSocket 由 Vite 管理。生产文件输出到 `dist/<package.name>`。

## 配置函数

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

## 插件形式

需要与其他 Vite 配置组合时，可以使用能力相同的插件形式：

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

## React 项目配置

每个 React 路径都相对于 `process.cwd()`，并且必须包含自己的 `package.json` 和 `vite.config.ts`。

公共包不会安装或注册 `@vitejs/plugin-react`。每个 React 项目自行提供完整的 Vite 配置：

```ts
// ../reactapp/vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
});
```

项目也可以改用 `@vitejs/plugin-react-swc`，或配置自己的 alias、CSS 选项和其他 Vite 插件。开发服务和生产构建都会加载同一份项目配置。

开发时，第一个 React 项目使用 Vite 命令启动的服务，其余项目由配置内部启动独立 Vite 服务，Hono 入口通过 `tsx` 运行。

生产时，各 React 项目输出到：

```text
dist/<package.name>
```

Hono 入口单独构建。

## 启动 Hono

Hono 入口使用配套的服务方法：

```ts
import honoServer from "vite.config/honoServer";

const server = honoServer({ fetch: app.fetch, hostname, port });
injectWebSocket(server);
```

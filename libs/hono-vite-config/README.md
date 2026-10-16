# hono-vite-config

使用一份 Vite 配置运行一个 Hono 服务端和一个或多个 React 渲染项目。业务端口在开发和生产中始终不变；开发期由 Vite 提供 React 与 HMR，并把业务请求代理到隐藏的 Hono 端口。插件不依赖 Hono 的 Vite 插件。

接入时使用目标项目现有的包管理器声明 `hono-vite-config` 和实际用到的 peer dependencies；不要假定目标项目使用 pnpm。以下公开入口是完整黑盒契约，调用方不复制其内部实现。

## 固定入口

```text
hono-vite-config/
├─ plugin.ts   # Vite 配置消费；创建开发服务和全部构建目标
├─ hono.ts     # 插件运行时黑盒；启动 Hono、热替换 app 并生成页面 URL
```

## Vite 配置

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import honoReact2 from "hono-vite-config/plugin";

export default defineConfig({
  plugins: [
    react(),
    honoReact2({
      hono: {
        external: [],
        path: "./libs/backend/index.ts",
        port: [3000, 3001],
        define: {},
      },
      renderer: {
        define: {},
        paths: [
          "./libs/frontend/index.tsx",
          "./libs/admin/index.tsx",
        ],
      },
    }),
  ],
});
```

配置契约：

- `hono.path` 与 `renderer.paths` 使用同一个 `path_t`：必须以 `.` 开始，并命名为 `index.ts` 或 `index.tsx`。
- `hono.port[0]` 是开发与生产始终使用的公开业务端口；`hono.port[1]` 是仅在开发期使用的隐藏 Hono 端口。两个端口必须不同，且都是 `1..65535` 的整数。
- `hono.define` 只注入 Hono 项目。
- `hono.external` 只放必须由 Node 在运行时加载的原生或 CommonJS 依赖；运行应用必须直接声明这些依赖。
- `renderer.paths` 是非空入口数组。
- `renderer.define` 只注入 renderer；`hono.define` 只注入 Hono SSR。两者都可省略。
- 每个 React 入口所在目录必须具有唯一的 `package.json#name`；该名称同时作为 URL 路径和 `dist` 子目录。
- 插件返回 Vite 可直接接收的插件组，不需要调用方展开。
- React 转换仍由目标项目的 `@vitejs/plugin-react` 提供，并与展开后的插件一起放入 `plugins`。
- React 项目不得提供 `index.html`；插件在开发和构建期间生成最小 HTML。
- 不在项目中手工拼接开发端口、生产端口、页面路径或构建输出路径。

## Hono 入口

```ts
import { honoServer } from "hono-vite-config/hono";
import routers from "./routers";

const server = honoServer(routers);

// 项目可在这里为同一个 server 注入 WebSocket、监听事件等能力。
export default server;
```

Hono 服务器由项目入口调用 `honoServer` 创建并默认导出；插件只负责在开发期加载项目入口、在构建期把它作为 Node 入口。开发时 Hono 监听隐藏端口，Vite 监听业务端口并代理业务请求；生产入口则由 Hono 直接监听业务端口并提供 API、静态资源及 SPA 回退。

`honoServer(app: Hono)` 返回真实 Node Server，项目可以在默认导出前为它注入 WebSocket 或其他 Node 服务能力。开发期始终保留同一个 Node Server；Vite SSR HMR 只重新执行受影响的模块并替换 Hono 请求应用，不关闭监听端口或既有连接。生产请求先经过 Hono 路由，仅在响应为 404 时继续处理 React 静态资源与 SPA 回退。调用方不得再创建第二套监听。

## 页面地址

```ts
import { honoUrl } from "hono-vite-config/hono";

const frontendUrl = honoUrl("frontend");
```

`honoUrl` 的参数必须等于目标 React 项目的 `package.json#name`，禁止调用方重新拼接 origin、端口或路径。

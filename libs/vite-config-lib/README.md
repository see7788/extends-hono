# vite-config-lib

使用一份 Vite 配置运行一个 Hono 服务端和一个或多个 React 渲染项目。开发和生产使用同一个公开端口；开发期 Hono 由 `@hono/vite-dev-server` 接入 Vite。

## 固定入口

```text
vite-config-lib/
├─ plugin2.ts  # Vite 配置消费；创建开发服务和全部构建目标
├─ hono.ts     # Hono 运行入口消费；启动生产服务并生成页面 URL
└─ convention.ts # vite-config-mcpserver 消费；读取本包规范原文
```

## Vite 配置

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import honoReact2 from "vite-config-lib/plugin2";

export default defineConfig({
  plugins: [
    react(),
    ...honoReact2({
      hono: {
        external: [],
        path: "./libs/backend/routers.ts",
        port: 3000,
        define: {},
      },
      renderer: [
        {},
        "./libs/frontend/index.tsx",
        "./libs/admin/index.tsx",
      ],
    }),
  ],
});
```

配置契约：

- `hono.path` 必须是以 `.` 开始的当前工作目录相对路径。
- `hono.port` 是开发与生产共同使用的唯一公开端口，必须是 `1..65535` 的整数。
- `hono.define` 只注入 Hono 项目。
- `hono.external` 只放必须由 Node 在运行时加载的原生或 CommonJS 依赖；运行应用必须直接声明这些依赖。
- `renderer[0]` 是所有 React 项目共享的 `define`。
- `renderer[1...]` 必须是以 `.` 开始、以 `/index.tsx` 结尾的入口路径。
- 每个 React 入口所在目录必须具有唯一的 `package.json#name`；该名称同时作为 URL 路径和 `dist` 子目录。
- 插件返回 `Plugin[]`，必须在 Vite `plugins` 中展开。
- React 项目不得提供 `index.html`；插件在开发和构建期间生成最小 HTML。
- 不在项目中手工拼接开发端口、生产端口、页面路径或构建输出路径。

## Hono 入口

```ts
import app from "./routers";
import { honoServer } from "vite-config-lib/hono";

honoServer(app);
```

生产环境由 `honoServer` 使用插件注入的主机、端口和 React 项目列表提供 Hono API、静态资源及 SPA 回退。

## 页面地址

```ts
import { honoUrl } from "vite-config-lib/hono";

const frontendUrl = honoUrl("frontend");
```

`honoUrl` 的参数必须等于目标 React 项目的 `package.json#name`，禁止调用方重新拼接 origin、端口或路径。

## MCP

配套包 `vite-config-mcpserver` 默认导出命名空间 `vite_config` 的静态 Register：

```text
vite_config
├─ honoReact2
├─ honoServer
└─ honoUrl
```

三个成员都是 AI 可自主调用的只读 Tool：`honoReact2` 只返回插件安装与配置步骤，`honoServer`、`honoUrl` 各自返回同名运行时黑盒契约；双方通过 `pairedTools` 互相指向。统一输入为 `projectPaths: string[]` 与 `task: create | modify | review`。

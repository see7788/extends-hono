# vite.config

使用普通 Vite 命令同时运行一个 Hono 入口和一个或多个 React Vite 项目。开发期间，对外 HTTP 地址始终使用 Hono 端口，内部 React 开发服务和 HMR WebSocket 由 Vite 管理。生产文件输出到 `dist/<package.name>`。

## 目标公开契约

下面的 tree 是待源码对齐的公开边界。任意数量的 React 项目都共用同一个 Vite 开发服务；`honoPort` 固定为 `[honoPort, devPort]`，项目数量不会改变端口数量。

```text
extends-hono.vite.config/
├── vite.ts                                  # 生产完整 Vite 配置
│   └── default(
│         options: {
│           honoEntry: string;
│           honoHost: string;
│           honoPort: readonly [honoPort: number, devPort: number];
│           webDefine?: Record<string, unknown>;
│         },
│         ...reactRoots: string[]
│       ): UserConfigExport
├── plugin.ts                                # 生产可组合的 Vite 插件
│   └── default(
│         options: {
│           honoEntry: string;
│           honoHost: string;
│           honoPort: readonly [honoPort: number, devPort: number];
│           webDefine?: Record<string, unknown>;
│         },
│         ...reactRoots: string[]
│       ): Plugin
├── honoServer.ts                            # 生产并启动正式 Hono 服务
│   └── default(hono: Hono): ReturnType<typeof serve>
└── url.ts                                   # 生产业务侧 Hono React 地址
    └── default<Name extends string>(name: Name): string
```

## 核心使用

```ts
// vite.config.ts
import viteConfig from "vite.config/vite";

export default viteConfig(
  {
    honoEntry: "src/index.ts",
    honoHost: "127.0.0.1",
    honoPort: [3005, 5173],
    webDefine: {
      __WEB_NAME__: JSON.stringify("reactapp"),
    },
  },
  "../reactapp",
);
```

```ts
// 与现有 Vite 配置组合
import { defineConfig } from "vite";
import honoReact from "vite.config/plugin";

export default defineConfig({
  plugins: [
    honoReact(
      {
        honoEntry: "src/index.ts",
        honoHost: "127.0.0.1",
        honoPort: [3005, 5173],
      },
      "../reactapp",
    ),
  ],
});
```

```ts
// Hono 进程入口
import app from "./routers";
import honoServer from "vite.config/honoServer";

honoServer(app);
```

```ts
// Node 业务侧取得 React 地址
import honoUrl from "vite.config/url";

const reactappUrl = honoUrl("reactapp");
```

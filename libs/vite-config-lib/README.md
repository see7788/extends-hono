# vite-config-lib

用一份 Vite 配置运行 Hono 和多个 React 项目。开发与生产都只使用 `mainPort`；`otherPort` 仅由插件在开发时内部使用。

## 使用接口

```text
vite-config-lib/
├── plugin.ts                            # Vite 配置使用
│   └── default(
│         options: {
│           honoEntry: string;                 # cwd 相对路径
│           honoHost: string;
│           honoPort: [
│             mainPort: number,                # 页面和接口统一使用；开发由 Vite 监听，生产由 Hono 监听
│             otherPort: number,               # 仅供开发时插件内部运行 Hono
│           ];
│         },
│         ...reactPkg: [
│           path: string,                      # cwd 相对路径；package.name 作为访问路径和 dist 目录名
│           define?: Record<string, unknown>,  # 只在当前 React 项目中生效
│         ][]
│       ): Plugin                              # 固定使用两个端口，任一被占用即停止；重载或退出时回收内部 Hono
└── hono.ts                              # Hono 项目使用
    ├── honoServer(hono: Hono): ReturnType<typeof serve> # 使用插件生产的端口启动 Hono
    └── honoUrl(name: package.name): string    # 返回 mainPort/package.name/ 完整地址
```

## Vite 配置

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import honoReact from "vite-config-lib/plugin";

export default defineConfig({
  plugins: [
    react(),
    honoReact(
      {
        honoEntry: "src/index.ts",
        honoHost: "127.0.0.1",
        honoPort: [3005, 3099],
      },
      [
        "../reactapp",
        {
          __WEB_NAME__: JSON.stringify("reactapp"),
          __API_PATH__: JSON.stringify("/reactapp/api"),
        },
      ],
      [
        "../../web/adminapp",
        {
          __WEB_NAME__: JSON.stringify("adminapp"),
          __API_PATH__: JSON.stringify("/adminapp/api"),
        },
      ],
    ),
  ],
});
```

## Hono 入口

```ts
import app from "./routers";
import { honoServer } from "vite-config-lib/hono";

honoServer(app);
```

## 取得页面地址

```ts
import { honoUrl } from "vite-config-lib/hono";

const reactappUrl = honoUrl("reactapp");
// http://127.0.0.1:3005/reactapp/
```

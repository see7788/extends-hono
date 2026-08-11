# remotedemo

基于 Hono 和 Chrome DevTools Protocol（CDP）的 Codex WebView 远程控制服务。

## 运行

在仓库根目录执行：

```powershell
pnpm --filter remotedemo dev
```

要求 Node.js `>=22.6`。

## 访问

- 控制页面：<http://127.0.0.1:3010/remote>
- 服务会自动查找当前工作区对应的 VS Code 调试窗口。
- 页面通过截图显示 WebView，并转发鼠标、键盘和文本输入。

生产运行可使用 `pnpm --filter remotedemo start`。

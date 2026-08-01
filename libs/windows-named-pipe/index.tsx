/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import * as React from "hono/jsx";
import Pm2 from "extends-ssh/Ubuntu/Pm2.ts";
import store from "./store.ts";
import type { NodeServiceState } from "./nodeService.ts";

const dateText = (value?: string) => value
  ? new Date(value).toLocaleString("zh-CN", { hour12: false })
  : "—";

const pm2 = new Pm2();

/** 关闭页面消费者持有的远程 PM2 SSH 会话。 */
export const dispose = () => pm2.dispose();

const page = (services: NodeServiceState[], windowsAvailable: boolean) => (
  <html lang="zh-CN">
    <head>
      <meta charSet="utf-8" />
      <meta content="width=device-width, initial-scale=1" name="viewport" />
      <title>Node 单例服务</title>
      <style dangerouslySetInnerHTML={{ __html: `
        :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", sans-serif; background: #090d16; color: #e8edf7; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #18233b 0, #090d16 52%); }
        main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
        header { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
        h1 { margin: 0; font-size: clamp(30px, 5vw, 52px); letter-spacing: -0.04em; }
        h2 { margin: 36px 0 14px; font-size: 22px; }
        header p { margin: 8px 0 0; color: #8f9bb3; }
        .message { min-height: 24px; color: #ffb4a9; text-align: right; }
        .panel { overflow: hidden; border: 1px solid #25314a; border-radius: 18px; background: rgba(12, 18, 31, 0.88); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 18px 20px; border-bottom: 1px solid #202b40; text-align: left; vertical-align: middle; }
        th { color: #8f9bb3; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
        tbody tr:last-child td { border-bottom: 0; }
        strong, small { display: block; }
        small { max-width: 420px; margin-top: 5px; overflow: hidden; color: #7d89a0; text-overflow: ellipsis; white-space: nowrap; }
        .status { display: inline-flex; align-items: center; gap: 8px; }
        .status::before { width: 9px; height: 9px; border-radius: 50%; background: #77839a; content: ""; }
        .status[data-status="running"]::before, .status[data-status="online"]::before { background: #4ee3a3; box-shadow: 0 0 16px rgba(78, 227, 163, 0.75); }
        .status[data-status="starting"]::before, .status[data-status="stopping"]::before { background: #ffcf5a; }
        .actions { display: flex; gap: 8px; }
        button { border: 1px solid #34425e; border-radius: 9px; background: #182238; color: #e8edf7; padding: 9px 14px; cursor: pointer; }
        button:hover { border-color: #6681b2; background: #202d49; }
        button[data-action="stop"] { color: #ffb4a9; }
        button:disabled { cursor: wait; opacity: 0.45; }
        .empty { padding: 52px 20px; color: #8f9bb3; text-align: center; }
        @media (max-width: 760px) { header { align-items: start; flex-direction: column; } .panel { overflow-x: auto; } }
      ` }} />
    </head>
    <body>
      <main>
        <header>
          <div>
            <h1>Node 单例服务</h1>
            <p>{windowsAvailable ? "Windows Named Pipe · 每 10 秒刷新" : "当前平台不提供 Windows Named Pipe"}</p>
          </div>
          <div class="message" id="node-message" role="status" />
        </header>
        <h2>Windows 本机</h2>
        <section class="panel">
          <table>
            <thead><tr><th>服务</th><th>状态</th><th>进程</th><th>启动时间</th><th>操作</th></tr></thead>
            <tbody id="services">
              {!windowsAvailable
                ? <tr><td class="empty" colSpan={5}>Windows Named Pipe 在当前平台不可用</td></tr>
                : services.length > 0 ? services.map(service => (
                <tr data-id={service.id}>
                  <td><strong>{service.command}</strong><small title={service.entry}>{service.entry}</small></td>
                  <td><span class="status" data-status={service.status}>{service.status}</span></td>
                  <td>{service.pid ? `${service.pid} / ${service.childPid ?? "—"}` : "—"}</td>
                  <td>{dateText(service.startedAt)}</td>
                  <td class="actions">
                    <button data-action="restart" type="button">重启</button>
                    <button data-action="stop" disabled={service.status === "stopped"} type="button">停止</button>
                  </td>
                </tr>
              )) : <tr><td class="empty" colSpan={5}>尚未发现单例 Node 服务</td></tr>}
            </tbody>
          </table>
        </section>
        <h2>Ubuntu PM2</h2>
        <div class="message" id="pm2-message" role="status" />
        <section class="panel">
          <table>
            <thead><tr><th>服务</th><th>状态</th><th>进程</th><th>启动时间</th><th>操作</th></tr></thead>
            <tbody id="pm2-services">
              <tr><td class="empty" colSpan={5}>正在读取远程 PM2 数据…</td></tr>
            </tbody>
          </table>
        </section>
      </main>
      <script dangerouslySetInnerHTML={{ __html: `
        const nodeBody = document.querySelector("#services");
        const nodeMessage = document.querySelector("#node-message");
        const pm2Body = document.querySelector("#pm2-services");
        const pm2Message = document.querySelector("#pm2-message");
        const windowsAvailable = ${windowsAvailable ? "true" : "false"};
        const escapeText = value => String(value ?? "").replace(/[&<>"']/g, character => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "'": "&#39;",
        })[character]);
        const dateText = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
        const nodeRender = services => {
          nodeBody.innerHTML = services.length ? services.map(service => \`
            <tr data-id="\${escapeText(service.id)}">
              <td><strong>\${escapeText(service.command)}</strong><small title="\${escapeText(service.entry)}">\${escapeText(service.entry)}</small></td>
              <td><span class="status" data-status="\${escapeText(service.status)}">\${escapeText(service.status)}</span></td>
              <td>\${service.pid ? \`\${service.pid} / \${service.childPid ?? "—"}\` : "—"}</td>
              <td>\${dateText(service.startedAt)}</td>
              <td class="actions"><button data-action="restart">重启</button><button data-action="stop" \${service.status === "stopped" ? "disabled" : ""}>停止</button></td>
            </tr>
          \`).join("") : '<tr><td class="empty" colspan="5">尚未发现单例 Node 服务</td></tr>';
        };
        const nodeStateRead = async () => {
          const response = await fetch("/state");
          if (!response.ok) throw new Error(await response.text());
          nodeRender(await response.json());
          nodeMessage.textContent = "";
        };
        nodeBody.addEventListener("click", async event => {
          const button = event.target.closest("button[data-action]");
          const row = button?.closest("tr[data-id]");
          if (!button || !row) return;
          row.querySelectorAll("button").forEach(current => current.disabled = true);
          nodeMessage.textContent = button.dataset.action === "stop" ? "正在停止…" : "正在重启…";
          try {
            const response = await fetch(\`/service/\${encodeURIComponent(row.dataset.id)}/\${button.dataset.action}\`, { method: "POST" });
            if (!response.ok) throw new Error(await response.text());
            nodeRender(await response.json());
            nodeMessage.textContent = "";
          } catch (error) {
            nodeMessage.textContent = error instanceof Error ? error.message : String(error);
            row.querySelectorAll("button").forEach(current => current.disabled = false);
          }
        });
        const pm2Render = state => {
          pm2Body.innerHTML = state.processes.length ? state.processes.map(service => \`
            <tr data-id="\${service.id}">
              <td><strong>\${escapeText(service.name)}</strong><small title="\${escapeText(service.script)}">\${escapeText(service.script ?? state.host)}</small></td>
              <td><span class="status" data-status="\${escapeText(service.status)}">\${escapeText(service.status)}</span></td>
              <td>\${escapeText(service.pid)}</td>
              <td>\${dateText(service.startedAt)}</td>
              <td class="actions"><button data-action="restart">重启</button><button data-action="stop" \${service.status === "stopped" ? "disabled" : ""}>停止</button></td>
            </tr>
          \`).join("") : '<tr><td class="empty" colspan="5">远程 PM2 当前没有项目</td></tr>';
        };
        const pm2StateRead = async () => {
          const response = await fetch("/pm2/state");
          if (!response.ok) throw new Error(await response.text());
          pm2Render(await response.json());
          pm2Message.textContent = "";
        };
        pm2Body.addEventListener("click", async event => {
          const button = event.target.closest("button[data-action]");
          const row = button?.closest("tr[data-id]");
          if (!button || !row) return;
          row.querySelectorAll("button").forEach(current => current.disabled = true);
          pm2Message.textContent = button.dataset.action === "stop" ? "正在停止远程服务…" : "正在重启远程服务…";
          try {
            const response = await fetch(\`/pm2/\${encodeURIComponent(row.dataset.id)}/\${button.dataset.action}\`, { method: "POST" });
            if (!response.ok) throw new Error(await response.text());
            pm2Render(await response.json());
            pm2Message.textContent = "";
          } catch (error) {
            pm2Message.textContent = error instanceof Error ? error.message : String(error);
            row.querySelectorAll("button").forEach(current => current.disabled = false);
          }
        });
        void pm2StateRead().catch(error => {
          pm2Message.textContent = error instanceof Error ? error.message : String(error);
        });
        if (windowsAvailable) {
          setInterval(() => void nodeStateRead().catch(error => {
            nodeMessage.textContent = error instanceof Error ? error.message : String(error);
          }), 10000);
        }
        setInterval(() => void pm2StateRead().catch(error => {
          pm2Message.textContent = error instanceof Error ? error.message : String(error);
        }), 10000);
      ` }} />
    </body>
  </html>
);

const router = new Hono().basePath("/node-service")
  .get("/", async context => context.html(page(
    process.platform === "win32" ? await store.getState().nodeServiceActions.stateRead() : [],
    process.platform === "win32",
  )))
  .get("/state", async context => context.json(await store.getState().nodeServiceActions.stateRead()))
  .post("/service/:id/stop", async context => (
    context.json(await store.getState().nodeServiceActions.stop(context.req.param("id")))
  ))
  .post("/service/:id/restart", async context => (
    context.json(await store.getState().nodeServiceActions.restart(context.req.param("id")))
  ))
  .get("/pm2/state", async context => context.json(await pm2.isRunning()))
  .post("/pm2/:id/stop", async context => (
    context.json(await pm2.stop(Number(context.req.param("id"))))
  ))
  .post("/pm2/:id/restart", async context => (
    context.json(await pm2.restart(Number(context.req.param("id"))))
  ));

router.onError((error, context) => context.json({ error: error.message }, 500));

export default router;

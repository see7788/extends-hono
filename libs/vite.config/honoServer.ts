import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { proxy } from "hono/proxy";

const reactFallback = new Hono().all("/:name/*", async (context) => {
  const name = context.req.param("name");
  if (
    !/^[A-Za-z0-9._~-]+$/.test(name)
    || (context.req.method !== "GET" && context.req.method !== "HEAD")
    || context.req.header("upgrade")?.toLowerCase() === "websocket"
    || context.req.header("accept")?.includes("text/event-stream")
  ) {
    return context.notFound();
  }

  if (process.env.NODE_ENV !== "production") {
    const projectUrl = process.env[`HONOREACT_URL_${name}`];
    if (!projectUrl) return context.notFound();
    const projectOrigin = new URL(projectUrl);
    const targetUrl = new URL(context.req.url);
    targetUrl.protocol = projectOrigin.protocol;
    targetUrl.host = projectOrigin.host;
    const headers = new Headers(context.req.raw.headers);
    headers.delete("host");
    const response = await proxy(targetUrl, { headers, raw: context.req.raw });
    const location = response.headers.get("location");
    if (location?.startsWith(projectOrigin.origin)) {
      response.headers.set("location", `${new URL(context.req.url).origin}${location.slice(projectOrigin.origin.length)}`);
    }
    return response;
  }

  if (!existsSync(join("dist", name, "index.html"))) return context.notFound();
  const staticResponse = await serveStatic({ root: "dist" })(context, async () => undefined);
  if (staticResponse) return staticResponse;
  if (!context.req.header("accept")?.includes("text/html")) return context.notFound();
  return await serveStatic({
    root: "dist",
    rewriteRequestPath: () => `/${name}/index.html`,
  })(context, async () => undefined) ?? context.notFound();
});

const honoServer: typeof serve = (options, listeningListener) => {
  const server = serve({
    ...options,
    fetch: async (request, env) => {
      const response = await options.fetch(request, env) as Response;
      return response.status === 404 ? reactFallback.fetch(request, env) : response;
    },
  }, listeningListener);
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Hono address ${options.hostname ?? "0.0.0.0"}:${String(options.port ?? 3000)} is already in use`);
    } else {
      console.error("Hono server failed:", error);
    }
    process.exitCode = 1;
    if (server.listening) server.close();
  });
  const close = () => server.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  server.once("close", () => {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
  });
  return server;
};

export default honoServer;

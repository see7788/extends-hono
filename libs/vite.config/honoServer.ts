import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

const staticHandler = serveStatic({ root: "dist" });
const spaHandler = serveStatic({
  root: "dist",
  rewriteRequestPath: (_path, context) => `/${context.req.param("name")}/index.html`,
});
const proxyHeaders = (headers: Headers) => {
  const result = new Headers(headers);
  for (const name of [
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    result.delete(name);
  }
  return result;
};
const reactFallback = new Hono().all("/:name/*", async (context) => {
  const name = context.req.param("name");
  if (
    !name
    || !/^[A-Za-z0-9._~-]+$/.test(name)
    || (context.req.method !== "GET" && context.req.method !== "HEAD")
    || context.req.header("upgrade")?.toLowerCase() === "websocket"
    || context.req.header("accept")?.includes("text/event-stream")
  ) {
    return context.notFound();
  }

  if (process.env.NODE_ENV !== "production") {
    const developmentNames = new Set(
      (process.env.HONOREACT_NAMES ?? "").split(",").filter(Boolean),
    );
    const projectUrl = developmentNames.has(name) ? process.env[`HONOREACT_URL_${name}`] : undefined;
    if (!projectUrl) return context.notFound();
    const targetUrl = new URL(projectUrl);
    const requestUrl = new URL(context.req.url);
    targetUrl.pathname = requestUrl.pathname;
    targetUrl.search = requestUrl.search;
    const requestHeaders = proxyHeaders(context.req.raw.headers);
    requestHeaders.delete("host");
    const response = await fetch(targetUrl, {
      headers: requestHeaders,
      method: context.req.method,
      redirect: "manual",
    });
    const responseHeaders = proxyHeaders(response.headers);
    const location = responseHeaders.get("location");
    if (location?.startsWith(new URL(projectUrl).origin)) {
      responseHeaders.set("location", `${requestUrl.origin}${location.slice(new URL(projectUrl).origin.length)}`);
    }
    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  }

  if (!existsSync(join("dist", name, "index.html"))) return context.notFound();
  const staticResponse = await staticHandler(context, async () => undefined);
  if (staticResponse) return staticResponse;
  if (!context.req.header("accept")?.includes("text/html")) return context.notFound();
  return await spaHandler(context, async () => undefined) ?? context.notFound();
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
    const address = `${options.hostname ?? "0.0.0.0"}:${String(options.port ?? 3000)}`;
    if (error.code === "EADDRINUSE") console.error(`Hono address ${address} is already in use`);
    else console.error("Hono server failed:", error);
    process.exitCode = 1;
    if (server.listening) server.close();
  });
  const serverClose = () => server.close();
  process.once("SIGINT", serverClose);
  process.once("SIGTERM", serverClose);
  server.once("close", () => {
    process.off("SIGINT", serverClose);
    process.off("SIGTERM", serverClose);
  });
  return server;
};

export default honoServer;

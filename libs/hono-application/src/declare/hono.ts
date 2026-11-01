import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServerType } from "@hono/node-server";
import { Hono, type Env } from "hono";

const honoServer = <E extends Env>(hono: Hono<E>): ServerType => {
  const config = {
    host: "127.0.0.1",
    port: 3000,
    origin: "http://127.0.0.1:3000",
    projects: ["__PACKAGE_NAME__-renderer"] as const,
    distDirectory: "dist",
  } as const;
  const staticApp = new Hono().use("*", serveStatic({ root: "." }));

  const runtimeFetch = async (request: Request): Promise<Response> => {
    const response = await hono.fetch(request);
    const url = new URL(request.url);
    const name = url.pathname.split("/")[1];
    const renderer = name !== undefined && config.projects.some(project => project === name);
    if (response.status !== 404 || (!renderer && name !== "assets")) return response;
    url.pathname = "/" + config.distDirectory + url.pathname;
    const staticResponse = await staticApp.fetch(new Request(url, request));
    if (
      staticResponse.status !== 404
      || !renderer
      || request.method !== "GET"
      || !request.headers.get("accept")?.includes("text/html")
    ) {
      return staticResponse;
    }
    url.pathname = "/" + config.distDirectory + "/" + name + "/index.html";
    return staticApp.fetch(new Request(url, request));
  };

  return serve({
    fetch: runtimeFetch,
    hostname: config.host,
    port: config.port,
  });
};

const honoUrl = <Name extends "__PACKAGE_NAME__-renderer">(name: Name) => (
  new URL("/" + name + "/", "http://127.0.0.1:3000").toString()
);

export default { honoServer, honoUrl };

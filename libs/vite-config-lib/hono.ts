import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Env } from "hono";

const host = process.env.HONOREACT_HOST;
if (!host) throw new Error("process.env.HONOREACT_HOST is required");
const port = Number(process.env.HONOREACT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("process.env.HONOREACT_PORT is invalid");
}
const origin = process.env.HONOREACT_ORIGIN;
if (!origin) throw new Error("process.env.HONOREACT_ORIGIN is required");
const projects = (process.env.HONOREACT_PROJECTS ?? "").split(",").filter(Boolean);
const staticApp = new Hono().use("*", serveStatic({ root: "." }));

export const honoServer = <E extends Env>(hono: Hono<E>) => serve({
  fetch: async request => {
    const response = await hono.fetch(request);
    const url = new URL(request.url);
    const name = url.pathname.split("/")[1];
    const renderer = name !== undefined && projects.includes(name);
    if (response.status !== 404 || (!renderer && name !== "assets")) return response;
    url.pathname = `/dist${url.pathname}`;
    const staticResponse = await staticApp.fetch(new Request(url, request));
    if (
      staticResponse.status !== 404
      || !renderer
      || request.method !== "GET"
      || !request.headers.get("accept")?.includes("text/html")
    ) {
      return staticResponse;
    }
    url.pathname = `/dist/${name}/index.html`;
    return staticApp.fetch(new Request(url, request));
  },
  hostname: host,
  port,
});

export const honoUrl = <Name extends string>(name: Name) => (
  new URL(`/${name}/`, origin).toString()
);

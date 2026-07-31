import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Env } from "hono";

const projects = (process.env.HONOREACT_PROJECTS ?? "").split(",").filter(Boolean);
const staticApp = new Hono().use("*", serveStatic({ root: "." }));

export const honoServer = <E extends Env>(hono: Hono<E>) => serve({
  fetch: async request => {
    const response = await hono.fetch(request);
    const url = new URL(request.url);
    const name = url.pathname.split("/")[1];
    if (response.status !== 404 || !name || !projects.includes(name)) return response;
    url.pathname = `/dist${url.pathname}`;
    const staticResponse = await staticApp.fetch(new Request(url, request));
    if (
      staticResponse.status !== 404
      || request.method !== "GET"
      || !request.headers.get("accept")?.includes("text/html")
    ) {
      return staticResponse;
    }
    url.pathname = `/dist/${name}/index.html`;
    return staticApp.fetch(new Request(url, request));
  },
  hostname: process.env.HONOREACT_HOST,
  port: Number(process.env.HONOREACT_PORT),
});

export const honoUrl = <Name extends string>(name: Name) => (
  new URL(`/${name}/`, process.env.HONOREACT_ORIGIN).toString()
);

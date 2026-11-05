import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServerType } from "@hono/node-server";
import { Hono, type Env } from "hono";

export const host = "127.0.0.1"; // AST 替换：Hono 监听主机
export const port = 0; // AST 替换：开发使用隐藏 Hono 端口，生产使用公开业务端口
export const origin = "http://127.0.0.1:0"; // AST 替换：公开业务 origin
const projects = ["template-project"] as const; // AST 替换：React 项目名称列表
const distDirectory = "dist"; // AST 替换：静态资源构建输出目录
export type ProjectName = "template-project"; // AST 替换：React 项目名称联合类型

const honoServer = <E extends Env>(hono: Hono<E>): ServerType => {
  const staticApp = new Hono().use("*", serveStatic({ root: "." }));

  const runtimeFetch = async (request: Request): Promise<Response> => {
    const response = await hono.fetch(request);
    const url = new URL(request.url);
    const name = url.pathname.split("/")[1];
    const renderer = name !== undefined && projects.some(project => project === name);
    if (response.status !== 404 || (!renderer && name !== "assets")) return response;
    url.pathname = "/" + distDirectory + url.pathname;
    const staticResponse = await staticApp.fetch(new Request(url, request));
    if (
      staticResponse.status !== 404
      || !renderer
      || request.method !== "GET"
      || !request.headers.get("accept")?.includes("text/html")
    ) {
      return staticResponse;
    }
    url.pathname = "/" + distDirectory + "/" + name + "/index.html";
    return staticApp.fetch(new Request(url, request));
  };

  return serve({
    fetch: runtimeFetch,
    hostname: host,
    port,
  });
};

const honoUrl = <Name extends ProjectName>(name: Name) => (
  new URL("/" + name + "/", origin).toString()
);

export { honoServer, honoUrl };
export default { honoServer, honoUrl, host, origin, port };

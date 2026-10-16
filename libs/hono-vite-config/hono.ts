import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServerType } from "@hono/node-server";
import { Hono, type Env } from "hono";

/* hono-vite-config:runtime-config:start */
const host = process.env.HONOREACT_HOST;
if (!host) throw new Error("process.env.HONOREACT_HOST is required");
const port = Number(process.env.HONOREACT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("process.env.HONOREACT_PORT is invalid");
}
const origin = process.env.HONOREACT_ORIGIN;
if (!origin) throw new Error("process.env.HONOREACT_ORIGIN is required");
const projects = (process.env.HONOREACT_PROJECTS ?? "").split(",").filter(Boolean);
type HonoProjectName = string;
/* hono-vite-config:runtime-config:end */
const staticApp = new Hono().use("*", serveStatic({ root: "." }));

type HonoRuntimeApp = {
  readonly fetch: (request: Request) => Response | Promise<Response>;
};

const runtimeFetch = async (
  app: HonoRuntimeApp,
  request: Request,
): Promise<Response> => {
  const response = await app.fetch(request);
  const url = new URL(request.url);
  const name = url.pathname.split("/")[1];
  const renderer = name !== undefined && projects.some(project => project === name);
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
};

/* hono-vite-config:runtime-lifecycle:start */
type ServerListener = (...input: unknown[]) => void;

type HonoRuntime = {
  app: HonoRuntimeApp;
  readonly baseListeners: ReadonlyMap<
    string | symbol,
    ReadonlySet<ServerListener>
  >;
  readonly server: ServerType;
};

const runtimeSymbol = Symbol.for("hono-vite-config.hono.runtimes");
const runtimeGlobal = globalThis as typeof globalThis & {
  [runtimeSymbol]?: Map<string, HonoRuntime>;
};
const runtimes = runtimeGlobal[runtimeSymbol] ??= new Map<string, HonoRuntime>();
const runtimeName = `${host}:${String(port)}`;

const serverBaseListeners = (
  server: ServerType,
): ReadonlyMap<string | symbol, ReadonlySet<ServerListener>> => {
  return new Map(server.eventNames().map(eventName => [
    eventName,
    new Set(server.listeners(eventName) as unknown as ServerListener[]),
  ]));
};

const serverExtensionsReset = (runtime: HonoRuntime): void => {
  for (const eventName of runtime.server.eventNames()) {
    const baseListeners = runtime.baseListeners.get(eventName);
    for (
      const listener of runtime.server.listeners(eventName) as unknown as ServerListener[]
    ) {
      if (!baseListeners?.has(listener)) runtime.server.removeListener(eventName, listener);
    }
  }
};

const runtimeCreate = (app: HonoRuntimeApp): HonoRuntime => {
  const runtime = { app } as HonoRuntime;
  const server = serve({
    fetch: request => runtimeFetch(runtime.app, request),
    hostname: host,
    port,
  });
  Object.assign(runtime, {
    baseListeners: new Map(),
    server,
  });
  server.once("close", () => {
    if (runtimes.get(runtimeName) === runtime) runtimes.delete(runtimeName);
  });
  Object.assign(runtime, { baseListeners: serverBaseListeners(server) });
  return runtime;
};

export const honoServer = <E extends Env>(hono: Hono<E>): ServerType => {
  const app: HonoRuntimeApp = { fetch: request => hono.fetch(request) };
  const runtime = runtimes.get(runtimeName);
  if (!runtime) {
    const created = runtimeCreate(app);
    runtimes.set(runtimeName, created);
    return created.server;
  }

  if (process.env.NODE_ENV === "development") serverExtensionsReset(runtime);
  runtime.app = app;
  return runtime.server;
};
/* hono-vite-config:runtime-lifecycle:end */

export const honoUrl = <Name extends HonoProjectName>(name: Name) => (
  new URL(`/${name}/`, origin).toString()
);

declare global {
  const honoViteConfig: {
    readonly honoServer: typeof honoServer;
    readonly honoUrl: typeof honoUrl;
  };
}

Object.assign(globalThis, {
  honoViteConfig: { honoServer, honoUrl },
});

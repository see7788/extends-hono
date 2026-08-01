import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createConnection } from "node:net";
import immerStateCreator from "extends-zustand/immerStateCreator";
import { z } from "zod";

const pipeRoot = "\\\\.\\pipe\\";
const pipeNameSchema = z.string().regex(/^[a-z0-9._-]+-[a-f0-9]{16}$/i);
const runtimeSchema = z.object({
  command: z.string().regex(/^[a-z0-9._-]+$/i),
  mode: z.enum(["dev", "start"]),
  status: z.enum(["starting", "running", "stopping", "stopped"]),
  pid: z.number().int().positive(),
  childPid: z.number().int().positive().optional(),
  entry: z.string().min(1),
  packageRoot: z.string().min(1),
  wrapper: z.string().min(1),
  startedAt: z.string().datetime(),
  control: z.string().min(1),
}).strict();

type NodeServiceRegistration = {
  id: string;
  command: string;
  control: string;
  entry: string;
  packageRoot: string;
  wrapper: string;
};

export type NodeServiceState = NodeServiceRegistration & {
  mode?: "dev" | "start";
  status: "starting" | "running" | "stopping" | "stopped";
  pid?: number;
  childPid?: number;
  startedAt?: string;
};

export type NodeServiceStore = {
  nodeService: Record<string, NodeServiceRegistration>;
  nodeServiceActions: {
    stateRead: () => Promise<NodeServiceState[]>;
    stop: (id: string) => Promise<NodeServiceState[]>;
    restart: (id: string) => Promise<NodeServiceState[]>;
  };
};

const controlNameRead = (control: string) => control.split("\\").at(-1) ?? control;

const controlRequest = (control: string, action: "status" | "stop" | "restart", timeout: number) =>
  new Promise<z.infer<typeof runtimeSchema> | undefined>((resolve, reject) => {
    let responseText = "";
    let settled = false;
    const socket = createConnection(control);
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    };
    const timer = setTimeout(() => {
      socket.destroy();
      if (settle()) reject(new Error(`Node service control request timed out: ${control}`));
    }, timeout);

    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ action })}\n`));
    socket.on("data", chunk => {
      responseText += chunk;
      const newlineIndex = responseText.indexOf("\n");
      if (newlineIndex < 0) return;
      try {
        const response = JSON.parse(responseText.slice(0, newlineIndex)) as {
          error?: unknown;
          state?: unknown;
        };
        if (response.error) throw new Error(String(response.error));
        const state = runtimeSchema.parse(response.state);
        socket.end();
        if (settle()) resolve(state);
      } catch (error) {
        socket.destroy();
        if (settle()) reject(error);
      }
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        if (settle()) resolve(undefined);
        return;
      }
      if (settle()) reject(error);
    });
    socket.once("close", () => {
      if (settle()) reject(new Error(`Node service control closed without a response: ${control}`));
    });
  });

const registrationRead = (state: z.infer<typeof runtimeSchema>): NodeServiceRegistration => {
  const id = controlNameRead(state.control);
  pipeNameSchema.parse(id);
  return {
    id,
    command: state.command,
    control: state.control,
    entry: state.entry,
    packageRoot: state.packageRoot,
    wrapper: state.wrapper,
  };
};

const stoppedStateRead = (service: NodeServiceRegistration): NodeServiceState => ({
  ...service,
  status: "stopped",
});

export default immerStateCreator<NodeServiceStore>((set, get) => {
  const stateRead = async () => {
    if (process.platform !== "win32") {
      throw new Error("Node service dashboard requires Windows Named Pipe");
    }
    const pipeNames = (await readdir(pipeRoot)).filter(name => pipeNameSchema.safeParse(name).success);
    const discovered = new Map<string, z.infer<typeof runtimeSchema>>();
    await Promise.all(pipeNames.map(async pipeName => {
      try {
        const state = await controlRequest(`${pipeRoot}${pipeName}`, "status", 1000);
        if (!state || controlNameRead(state.control) !== pipeName) return;
        discovered.set(pipeName, state);
      } catch {
        // Matching pipe names are ignored until they return the complete protocol.
      }
    }));
    if (discovered.size > 0) {
      set(current => {
        for (const state of discovered.values()) {
          const service = registrationRead(state);
          current.nodeService[service.id] = service;
        }
      });
    }
    const invalidIds = Object.values(get().nodeService)
      .filter(service => !existsSync(service.wrapper))
      .map(service => service.id);
    if (invalidIds.length > 0) {
      set(current => {
        for (const id of invalidIds) delete current.nodeService[id];
      });
    }
    const services = Object.values(get().nodeService)
      .sort((left, right) => left.command.localeCompare(right.command));
    return Promise.all(services.map(async (service): Promise<NodeServiceState> => {
      const current = discovered.get(service.id);
      if (current) return { ...service, ...current, id: service.id };
      if (!pipeNames.includes(service.id)) return stoppedStateRead(service);
      const state = await controlRequest(service.control, "status", 1000);
      return state ? { ...service, ...state, id: service.id } : stoppedStateRead(service);
    }));
  };

  return {
    nodeService: {},
    nodeServiceActions: {
      stateRead,
      stop: async id => {
        const service = get().nodeService[id];
        if (!service) throw new Error(`Node service is not registered: ${id}`);
        const current = await controlRequest(service.control, "status", 1000);
        if (!current) return stateRead();
        await controlRequest(service.control, "stop", 15000);
        for (let index = 0; index < 100; index += 1) {
          if (!await controlRequest(service.control, "status", 1000)) return stateRead();
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error(`Node service did not stop: ${service.command}`);
      },
      restart: async id => {
        const service = get().nodeService[id];
        if (!service) throw new Error(`Node service is not registered: ${id}`);
        await controlRequest(service.control, "restart", 30000);
        return stateRead();
      },
    },
  };
});

import type {} from "zustand/middleware/immer";
import type { StateCreator } from "zustand/vanilla";
import type { Store } from "../../store/type";

type AgentRuntimeSlice = Pick<Store, "agentRuntime" | "agentRuntimeActions">;

const agentRuntimeSlice: StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  AgentRuntimeSlice
> = (set, get) => ({
  agentRuntime: {
    idNext: 1,
    sessions: {},
  },
  agentRuntimeActions: {
    list: () => Object.values(get().agentRuntime.sessions).sort((left, right) => left.id - right.id),
    sessionClose: sessionId => set(state => {
      delete state.agentRuntime.sessions[sessionId];
    }),
    sessionGet: sessionId => {
      const runtime = get().agentRuntime.sessions[sessionId];
      if (!runtime) throw new Error("当前 MCP 会话尚未调用 conversation.init。");
      return runtime;
    },
    projectBind: options => {
      const current = get().agentRuntime.sessions[options.sessionId];
      const runtime = current
        ? {
            ...current,
            projectIds: current.projectIds.includes(options.projectId)
              ? current.projectIds
              : [...current.projectIds, options.projectId],
          }
        : {
            id: get().agentRuntime.idNext,
            projectIds: [options.projectId],
            windowPath: options.windowPath,
          };
      set(state => {
        if (!current) state.agentRuntime.idNext += 1;
        state.agentRuntime.sessions[options.sessionId] = runtime;
      });
      return runtime;
    },
  },
});

export default agentRuntimeSlice;

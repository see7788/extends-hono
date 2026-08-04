import type {} from "zustand/middleware/immer";
import type { StateCreator } from "zustand/vanilla";
import type { Store } from "../../store/type";

type AiRuntimeSlice = Pick<Store, "aiRuntime" | "aiRuntimeActions">;

const aiRuntimeSlice: StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  AiRuntimeSlice
> = (set, get) => ({
  aiRuntime: {
    idNext: 1,
    sessions: {},
  },
  aiRuntimeActions: {
    list: () => Object.values(get().aiRuntime.sessions).sort((left, right) => left.id - right.id),
    sessionClose: sessionId => set(state => {
      delete state.aiRuntime.sessions[sessionId];
    }),
    sessionGet: sessionId => {
      const runtime = get().aiRuntime.sessions[sessionId];
      if (!runtime) throw new Error("当前 MCP 会话尚未调用 conversation.init。");
      return runtime;
    },
    workspaceSet: options => {
      const current = get().aiRuntime.sessions[options.sessionId];
      const runtime = current
        ? {
            ...current,
            projectIds: current.projectIds.includes(options.projectId)
              ? current.projectIds
              : [...current.projectIds, options.projectId],
          }
        : {
            id: get().aiRuntime.idNext,
            projectIds: [options.projectId],
            workspacePath: options.workspacePath,
          };
      set(state => {
        if (!current) state.aiRuntime.idNext += 1;
        state.aiRuntime.sessions[options.sessionId] = runtime;
      });
      return runtime;
    },
  },
});

export default aiRuntimeSlice;

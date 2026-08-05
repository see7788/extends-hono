import type {} from "zustand/middleware/immer";
import type { StateCreator } from "zustand/vanilla";
import type { Store } from "../store/type";

type McpErrorSlice = Pick<Store, "mcpError" | "mcpErrorActions">;

const mcpErrorSlice: StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  McpErrorSlice
> = set => ({
  mcpError: {
    entries: [],
  },
  mcpErrorActions: {
    errorAdd: error => set(state => {
      state.mcpError.entries.push(error);
    }),
  },
});

export default mcpErrorSlice;

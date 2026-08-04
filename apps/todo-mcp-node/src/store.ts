import cwdPersist from "extends-zustand/cwdPersist";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import todotreeStore, { type TodoTreeStore } from "./todotree/store.ts";

const store = createStore<TodoTreeStore>()(cwdPersist({
  cwd: "D:\\ssdpro",
  name: "todo-mcp-store",
  initializer: immer(todotreeStore),
}));

export default store;

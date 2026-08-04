import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import todotree, { type TodoTreeStore } from "./todotree/store.ts";

const store = createStore<TodoTreeStore>()(
  persist(immer(todotree), {
    name: join("D:\\", "ssdpro", "todo-mcp-store.json"),
    onRehydrateStorage: () => (_state, error) => {
      if (error) throw error;
    },
    partialize: state => ({ todotree: state.todotree }),
    storage: createJSONStorage(() => {
      let unpersistedCount = 0;
      const stateStorage: StateStorage = {
        getItem: name => existsSync(name) ? readFileSync(name, "utf8") : null,
        removeItem: name => {
          unpersistedCount = 0;
          rmSync(name, { force: true });
        },
        setItem: (name, value) => {
          unpersistedCount += 1;
          if (unpersistedCount < 200) return;
          mkdirSync(dirname(name), { recursive: true });
          writeFileSync(name, value, { encoding: "utf8", flush: true });
          unpersistedCount = 0;
        },
      };
      return stateStorage;
    }),
  }),
);

export default store;

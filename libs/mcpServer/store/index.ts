import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore, type StateCreator } from "zustand/vanilla";
import mcpErrorSlice from "../mcp/error";
import workcopySlice from "../mcp/workcopy/store";
import type { Store } from "./type";

const stateRead = (name: string) => {
  if (!existsSync(name)) return null;
  const content = readFileSync(name, "utf8");
  JSON.parse(content);
  return content;
};

const stateStorage: StateStorage = {
  getItem: name => {
    try {
      return stateRead(name);
    } catch (error) {
      throw new Error(`Cannot read the todo-mcp store at ${name}.`, {
        cause: error,
      });
    }
  },
  removeItem: name => {
    rmSync(name, { force: true });
  },
  setItem: (name, value) => {
    JSON.parse(value);
    mkdirSync(dirname(name), { recursive: true });
    writeFileSync(name, value, { encoding: "utf8", flush: true });
  },
};

const storeSlice: StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  Store
> = (...options) => ({
  ...mcpErrorSlice(...options),
  ...workcopySlice(...options),
});

const store = createStore<Store>()(
  persist(immer(storeSlice), {
    name: join("D:\\", "ssdpro", ".todo-mcp", "store.json"),
    onRehydrateStorage: () => (_state, error) => {
      if (error) throw error;
    },
    storage: createJSONStorage(() => stateStorage),
    partialize: state => ({
      mcpError: state.mcpError,
      workcopy: state.workcopy,
    }),
  }),
);

export default store;

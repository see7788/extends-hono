import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
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

const statePath = "D:\\ssdpro\\.todo-mcp\\store.json";
const stateBackupPath = `${statePath}.backup`;
const stateNextPath = `${statePath}.next`;

const stateRead = (path: string) => {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  JSON.parse(content);
  return content;
};

const stateStorage: StateStorage = {
  getItem: () => {
    let stateError: unknown;
    try {
      const state = stateRead(statePath);
      if (state !== null) return state;
    } catch (error) {
      stateError = error;
    }
    try {
      const backup = stateRead(stateBackupPath);
      if (backup !== null) return backup;
    } catch (backupError) {
      if (stateError) {
        throw new AggregateError(
          [stateError, backupError],
          `Cannot read the todo-mcp store at ${statePath}.`,
        );
      }
      throw backupError;
    }
    if (stateError) {
      throw new Error(`Cannot read the todo-mcp store at ${statePath}.`, {
        cause: stateError,
      });
    }
    return null;
  },
  removeItem: () => {
    rmSync(statePath, { force: true });
    rmSync(stateBackupPath, { force: true });
    rmSync(stateNextPath, { force: true });
  },
  setItem: (_name, value) => {
    JSON.parse(value);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(stateNextPath, value, { encoding: "utf8", flush: true });
    rmSync(stateBackupPath, { force: true });
    if (existsSync(statePath)) renameSync(statePath, stateBackupPath);
    try {
      renameSync(stateNextPath, statePath);
    } catch (writeError) {
      if (!existsSync(statePath) && existsSync(stateBackupPath)) {
        renameSync(stateBackupPath, statePath);
      }
      throw writeError;
    }
    rmSync(stateBackupPath, { force: true });
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

stateStorage.getItem("todo-mcp");

const store = createStore<Store>()(
  persist(immer(storeSlice), {
    name: "todo-mcp",
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

import { homedir } from "node:os";
import cwdPersist from "extends-zustand/cwdPersist";
import nodeService, { type NodeServiceStore } from "./nodeService.ts";
import { createStore } from "zustand";
import { immer } from "zustand/middleware/immer";

export type Store = NodeServiceStore;

export default createStore<Store>()(
  cwdPersist({
    cwd: homedir(),
    name: "windows-named-pipe",
    initializer: immer<Store>((set, get, api) => ({
      ...nodeService(set, get, api),
    })),
  }),
);

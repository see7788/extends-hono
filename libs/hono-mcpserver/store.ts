import { createStore, type StoreApi } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";
import viteConfig from "./vite-config/store";

type Store = ReturnType<typeof viteConfig>;

export default createStore<Store>()(
  immer((...options) => ({
    ...viteConfig(...options),
  })),
) satisfies StoreApi<Store>;

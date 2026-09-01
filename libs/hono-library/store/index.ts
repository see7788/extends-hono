// 此文件只负责组合 Zustand 主 Store。
import { immer } from "zustand/middleware/immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Store } from "./type";

export default createStore<Store>()(
  immer((...options) => ({

  })),
) satisfies StoreApi<Store>;

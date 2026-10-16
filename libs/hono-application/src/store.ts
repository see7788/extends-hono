// 此文件只负责组合。多个类型createStore内用&合并，不要定义碎片
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import baseStore from "./routers/base/store";
export default createStore<ReturnType<typeof baseStore>>()(
  immer((...options) => ({
    ...baseStore(...options),
  })),
)

// 此文件只负仅仅组装切片仓库，不承担任何业务。
// createStore内用ReturnType&合并，不要定义碎片类型
// 让所有切片无副作用，副作用方法放在个文件执行
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import baseStore from "./routers/base/store";
export default createStore<ReturnType<typeof baseStore>>()(
  immer((...options) => ({
    ...baseStore(...options),
  })),
)

import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { test_zod as zod } from "./zod"
import { z } from "zod";
//消费者只有主仓库
//数据根级名称===切片名称
//Actions只能放方法以及不需要持久化的部分
const store: ImmerStateCreator<{
  base: z.output<typeof zod>;
  baseActions: {}
}> = () => ({
  base: { health: { ok: true } },
  baseActions: {}
})

export default store
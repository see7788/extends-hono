import { createStore } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";
import conventionStore from "./convention/store";

type Store = ReturnType<typeof conventionStore>;

const store = createStore<Store>()(
  immer((...options) => ({
    ...conventionStore<Store>(...options),
  })),
);

export default store;

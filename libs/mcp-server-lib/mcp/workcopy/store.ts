import type { StateCreator } from "zustand/vanilla";
import type {} from "zustand/middleware/immer";
import type { Store } from "../../store/type";

type WorkcopySlice = Pick<Store, "workcopy" | "workcopyActions">;

const workcopySlice: StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  WorkcopySlice
> = set => ({
  workcopy: {
    projects: {},
  },
  workcopyActions: {
    projectSet: project => set(state => {
      state.workcopy.projects[project.sourceKey] = project;
    }),
  },
});

export default workcopySlice;

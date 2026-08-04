import type { ImmerStateCreator } from "extends-zustand/immerStateCreator";
import { hc } from "hono/client";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";
import todotree, { TodoTreeStore } from "todo-mcp-node/src/todotree/store.ts";
export type todotree_t = TodoTreeStore & { connect: () => () => void }
const store: ImmerStateCreator<todotree_t> = (_set, get, store) => ({
  ...todotree(_set, get, store),
  connect: () => {
    const client = hc<TodoMcpApi>(window.location.origin);
    const eventSource = new EventSource(client["todo-mcp-node"].events.$url());
    eventSource.addEventListener("tree", event => {
      get().todotreeActions.treeSet(
        JSON.parse(event.data) as TodoTreeStore["todotree"],
      );
    });
    eventSource.addEventListener("add", event => {
      get().todotreeActions.add(
        JSON.parse(event.data) as Parameters<TodoTreeStore["todotreeActions"]["add"]>[0],
      );
    });
    eventSource.addEventListener("del", event => {
      get().todotreeActions.del(JSON.parse(event.data) as number);
    });
    eventSource.addEventListener("set", event => {
      get().todotreeActions.set(
        JSON.parse(event.data) as Parameters<TodoTreeStore["todotreeActions"]["set"]>[0],
      );
    });
    return () => eventSource.close();
  },
});

export default store;

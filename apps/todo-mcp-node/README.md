# todo-mcp-node

`todo-mcp-node` 鍦ㄤ竴涓?Hono 鍏ュ彛涓氦浠?todo-mcp銆乀odoTree 椤甸潰銆佸師 honoapp 妯℃澘鑳藉姏鍜?create-todo-cli锛涜繍琛?`pnpm --filter todo-mcp-node dev` 鍚庢墦寮€ `http://127.0.0.1:3005/todotree/` 浣跨敤銆?
## 椤圭洰缁撴瀯

```text
todo-mcp-node/
鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ index.ts
鈹?  鈹溾攢鈹€ routers.ts
鈹?  鈹?  鈹溾攢鈹€ type TodoMcpApi = typeof router
鈹?  鈹?  鈹?  // 浜や粯鍓嶇 hc 娑堣垂鐨勫畬鏁?Hono API 绫诲瀷銆?鈹?  鈹?  鈹斺攢鈹€ default: Hono
鈹?  鈹?      // 缁勫悎 mcp-server-lib銆乭onoapp銆乵cpcreate-lib 涓?todotree锛涜皟鐢?todotree/index.default銆?鈹?  鈹斺攢鈹€ todotree/
鈹?      鈹溾攢鈹€ contract.ts
鈹?      鈹?  鈹溾攢鈹€ const statusOptions: readonly Option<Status>[]
鈹?      鈹?  鈹?  // 鐢熶骇 Hono銆丮CP 涓庨〉闈㈠叡鐢ㄧ殑瀹屾暣 1-9 鐘舵€佹槧灏勩€?鈹?      鈹?  鈹溾攢鈹€ const statusOptionsVisible: readonly Option<Status>[]
鈹?      鈹?  鈹?  // 鐢熶骇鏈惎鐢ㄥ伐浣滈槦鏃剁殑椤甸潰鐘舵€佸叆鍙ｃ€?鈹?      鈹?  鈹溾攢鈹€ const templateOptions: readonly Option<Template>[]
鈹?      鈹?  鈹?  // 鐢熶骇 Hono銆丮CP 涓庨〉闈㈠叡鐢ㄧ殑鑺傜偣妯℃澘鏄犲皠銆?鈹?      鈹?  鈹斺攢鈹€ const contractValidator: { agent; status; template }
鈹?      鈹?      // 鐢熶骇鑺傜偣鍘熷瀛楁鐨勫敮涓€楠岃瘉鍣ㄣ€?鈹?      鈹溾攢鈹€ store.ts
鈹?      鈹?  鈹溾攢鈹€ [鍐匽 const validator: { add; batch; conversationInit; del; move; nodeSearch;
鈹?      鈹?  鈹?    projectAttention; projectMaintenance; projectMigrate; projectNodeRead;
鈹?      鈹?  鈹?    projectRegister; projectResolve; set; taskBlock; taskCancel; taskComplete;
鈹?      鈹?  鈹?    taskDecision; taskId; taskOpen; taskOpenMany }
鈹?      鈹?  鈹?  // 鐢熶骇 index.ts 娉ㄥ唽 Hono 涓?MCP 鎵€闇€鐨勮緭鍏ュ绾︼紱璋冪敤 contract.contractValidator銆?鈹?      鈹?  鈹溾攢鈹€ type TodoTreeNode = z.infer<typeof node>
鈹?      鈹?  鈹?  // 浜や粯鍓嶇娑堣垂鐨勫敮涓€姝ｅ紡鑺傜偣绫诲瀷銆?鈹?      鈹?  鈹溾攢鈹€ type TodoTreeState = z.infer<typeof treeState>
鈹?      鈹?  鈹?  // 浜や粯鍓嶇娑堣垂鐨勫畬鏁存爲銆佽矾寰勫瓨鍦ㄧ姸鎬佸拰浠诲姟鍏虫敞鏁版嵁銆?鈹?      鈹?  鈹斺攢鈹€ [鍐匽 default: {
鈹?      鈹?      todotreeActions: {
鈹?      鈹?        add(options): TodoTreeNode;
鈹?      鈹?        batch(options): TodoTreeNode[];
鈹?      鈹?        del(id: number): number[];
鈹?      鈹?        move(options): TodoTreeNode;
鈹?      鈹?        set(options): TodoTreeNode;
鈹?      鈹?        projectRegister(projectPath: string): TodoTreeProject;
鈹?      鈹?        projectMigrate(options): TodoTreeProject;
鈹?      鈹?        projectAttention(options): Record<number, ProjectAttention>;
鈹?      鈹?        projectList(): TodoTreeNode[];
鈹?      鈹?        projectMaintenance(): {
鈹?      鈹?          projectId: number;
鈹?      鈹?          projectPath: string;
鈹?      鈹?          reason: "path_missing";
鈹?      鈹?        }[];
鈹?      鈹?        projectResolve(workspacePath: string): TodoTreeProject;
鈹?      鈹?        conversationInit(options): {
鈹?      鈹?          projectId: number;
鈹?      鈹?          windowPath: string;
鈹?      鈹?          nodesById: Record<number, TodoTreeNode>;
鈹?      鈹?        };
鈹?      鈹?        taskOpen(options): TodoTreeNode;
鈹?      鈹?        taskOpenMany(options): TodoTreeNode[];
鈹?      鈹?        taskStart(options): TodoTreeNode;
鈹?      鈹?        taskComplete(options): TodoTreeNode;
鈹?      鈹?        taskBlock(options): TodoTreeNode;
鈹?      鈹?        taskCancel(options): TodoTreeNode;
鈹?      鈹?        taskDecision(options): TodoTreeNode;
鈹?      鈹?        projectTree(workspacePath: string): TodoTreeProject;
鈹?      鈹?        projectNodeGet(options): TodoTreeNode;
鈹?      鈹?        projectNodeChildren(options): TodoTreeNode[];
鈹?      鈹?        projectNodeContext(options): TodoTreeProject;
鈹?      鈹?        projectNodeSearch(options): TodoTreeNode[];
鈹?      鈹?        tree(): TodoTreeState;
鈹?      鈹?      };
鈹?      鈹?    }
鈹?      鈹?      // 鍙淮鎶?todotree_node 鍘熷琛紝骞剁敓浜ч」鐩€佷换鍔°€佹煡璇㈠拰杩佺Щ缁撴灉銆?鈹?      鈹斺攢鈹€ index.ts
鈹?          鈹斺攢鈹€ default: Register
鈹?              // 浜や粯 TodoTree Hono/MCP 鎺ュ彛涓?SSE锛涜皟鐢?contract.templateOptions銆乻tore.default.todotreeActions銆?鈹溾攢鈹€ vite.config.ts                                  // 鍥哄畾 3005 骞舵瀯寤?todotree
鈹斺攢鈹€ package.json
```

## 鏍稿績浣跨敤鏂规硶

```powershell
pnpm --filter todo-mcp-node dev
```

```ts
import { hc } from "hono/client";
import type { TodoMcpApi } from "todo-mcp-node/src/routers.ts";

const client = hc<TodoMcpApi>(window.location.origin);
const response = await client["todo-mcp-node"].tree.$get();
const tree = await response.json();
```

TodoTree 椤甸潰浣嶄簬 `http://127.0.0.1:3005/todotree/`锛孧CP 浣嶄簬 `http://127.0.0.1:3005/todo-mcp`锛汼QLite 浣嶄簬 `join(homedir(), ".store", md5(projectPath), "store.sqlite")`銆侫I 鍏堣皟鐢?`conversation.init` 缁戝畾鐪熷疄绐楀彛涓庨」鐩紝鍐嶇敤 `task.open` 鎴?`task.openMany` 寤虹珛浠诲姟锛涙櫘閫?Hono 椤甸潰璋冪敤涓嶅彈 MCP 浼氳瘽绾︽潫銆?

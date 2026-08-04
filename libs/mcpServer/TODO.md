# mcp-server 待实现源码蓝图

以下 tree 只记录尚未实施的一致化目标。实现过程中先修改本 tree，确认公开契约闭合后再修改源码和消费者。

```text
libs/mcpServer/
├── index.ts
│   └── class Mcp<CurrentSchema extends Schema = {}>
│       ├── constructor()
│       │                                                    // 使用母库自身身份创建实例并装配全部配件
│       ├── register<
│       │     Namespace extends string,
│       │     FragmentSchema extends Schema,
│       │   >(
│       │     register: Register<Namespace, FragmentSchema>,
│       │   ): Mcp<
│       │     CurrentSchema
│       │       | MergeSchemaPath<FragmentSchema, MergePath<"/", `/${Namespace}`>>
│       │   >                                                // 调用 register.deliver() 并消费唯一交付数据
│       ├── registerPkg<
│       │     Namespace extends string,
│       │     FragmentSchema extends Schema,
│       │   >(
│       │     register: RegisterFromNpm<Namespace, FragmentSchema>,
│       │   ): Promise<Mcp<
│       │     CurrentSchema
│       │       | MergeSchemaPath<FragmentSchema, MergePath<"/", `/${Namespace}`>>
│       │   >>                                               // 调用 await register.deliver() 并保留运行时维护对象
│       └── readonly hono: HonoBase<BlankEnv, CurrentSchema, "/", "/">
│                                                            // 交付统一 Hono 路由与 /todo-mcp
├── public.ts
│   ├── type ToolRegistration = {
│   │     name: string;
│   │     config: {
│   │       title?: string;
│   │       description: string;
│   │       inputSchema: z.ZodObject<z.ZodRawShape>;
│   │       outputSchema?: StandardSchemaWithJSON;
│   │       annotations: ToolContractAnnotations;
│   │       icons?: Icon[];
│   │       _meta?: Record<string, unknown>;
│   │     };
│   │     handler: ToolCallback<z.ZodObject<z.ZodRawShape>>;
│   │   }                                              // [内] 可直接展开给 McpServer.registerTool()
│   ├── type RegistrationData<
│   │     Namespace extends string,
│   │     CurrentSchema extends Schema,
│   │   > = {
│   │     namespace: Namespace;
│   │     hono: HonoBase<
│   │       BlankEnv,
│   │       MergeSchemaPath<CurrentSchema, MergePath<"/", `/${Namespace}`>>,
│   │       "/",
│   │       "/"
│   │     >;
│   │     tools: readonly ToolRegistration[];
│   │   }                                              // [内] 两种注册器向母库交付的唯一成品数据
│   └── class Register<
│         Namespace extends string,
│         CurrentSchema extends Schema = {},
│       >
│       ├── constructor(options: {
│       │     namespace: Namespace;
│       │   })                                         // 收集整个注册成品唯一且必需的根配置
│       ├── register<
│       │     const Path extends `/${string}`,
│       │     HonoEnv extends Env,
│       │     ChildSchema extends Schema,
│       │     HonoBasePath extends string,
│       │     HonoCurrentPath extends string,
│       │     InputSchema extends z.ZodObject<z.ZodRawShape>,
│       │   >(...definition: Definition<
│       │     Path,
│       │     HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
│       │     InputSchema
│       │   >): Register<
│       │     Namespace,
│       │     CurrentSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
│       │   >                                          // 收集命名空间内的相对动作路径与完整动作契约
│       ├── honoAdd<
│       │     const Path extends `/${string}`,
│       │     HonoEnv extends Env,
│       │     ChildSchema extends Schema,
│       │     HonoBasePath extends string,
│       │     HonoCurrentPath extends string,
│       │   >(
│       │     path: Path,
│       │     hono: HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
│       │   ): Register<
│       │     Namespace,
│       │     CurrentSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
│       │   >                                          // 收集只交付给 Hono 的相对接口
│       ├── readonly hono: RegistrationData<Namespace, CurrentSchema>["hono"]
│       │                                              // 不挂载 MCP 时直接交付完整 Hono
│       └── deliver(): RegistrationData<Namespace, CurrentSchema>
│                                                      // 验证全部收集结果并唯一交付完整 Hono 与工具数据
├── mcpFromNpm/
│   ├── public.ts
│   │   └── class RegisterFromNpm<
│   │         Namespace extends string,
│   │         AddedSchema extends Schema = {},
│   │       >
│   │       ├── constructor(options: {
│   │       │     namespace: Namespace;
│   │       │   })                                     // 收集整个注册成品唯一且必需的根配置
│   │       ├── registerPkg(options: {
│   │       │     transport: () => Transport | Promise<Transport>;
│   │       │     instructions?: string;
│   │       │   }): this                               // 收集唯一外部 MCP 来源及其使用说明
│   │       ├── mcpDel(toolName: string): this         // 收集需要从成品包删除的指定 MCP 注册
│   │       ├── mcpReplace(replacement: Replacement): this
│   │       │                                          // 收集指定成品 MCP 注册的契约替换
│   │       ├── register<
│   │       │     const Path extends `/${string}`,
│   │       │     HonoEnv extends Env,
│   │       │     ChildSchema extends Schema,
│   │       │     HonoBasePath extends string,
│   │       │     HonoCurrentPath extends string,
│   │       │     InputSchema extends z.ZodObject<z.ZodRawShape>,
│   │       │   >(
│   │       │     definition: Definition<
│   │       │       Path,
│   │       │       HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
│   │       │       InputSchema
│   │       │     > | ((toolCall: ToolCall) => Definition<
│   │       │       Path,
│   │       │       HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
│   │       │       InputSchema
│   │       │     >),
│   │       │   ): RegisterFromNpm<
│   │       │     Namespace,
│   │       │     AddedSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
│   │       │   >                                      // 收集同时交付给 Hono 与 MCP 的完整接口
│   │       ├── honoAdd<
│   │       │     const Path extends `/${string}`,
│   │       │     HonoEnv extends Env,
│   │       │     ChildSchema extends Schema,
│   │       │     HonoBasePath extends string,
│   │       │     HonoCurrentPath extends string,
│   │       │   >(
│   │       │     path: Path,
│   │       │     hono: HonoBase<HonoEnv, ChildSchema, HonoBasePath, HonoCurrentPath>,
│   │       │   ): RegisterFromNpm<
│   │       │     Namespace,
│   │       │     AddedSchema | MergeSchemaPath<ChildSchema, MergePath<"/", Path>>
│   │       │   >                                      // 收集只交付给 Hono 的相对接口
│   │       ├── readonly hono: Promise<RegistrationData<Namespace, AddedSchema>["hono"]>
│   │       │                                          // 连接来源但不挂载 MCP，异步交付完整 Hono
│   │       ├── deliver(): Promise<RegistrationData<Namespace, AddedSchema>>
│   │       │                                          // 连接来源，验证全部收集结果并唯一交付完整成品数据
│   │       ├── healthAudit(): Promise<boolean>        // [内] 检查运行时；失效时调用 close()
│   │       └── close(): Promise<void>                 // [内] 精确关闭 Client 与 Transport
│   ├── browser.ts                                     // new RegisterFromNpm({ namespace: "browser" }).registerPkg(...).register(...)
│   ├── codegraph.ts                                   // new RegisterFromNpm({ namespace: "codegraph" }).registerPkg(...).register(...)
│   ├── docs.ts                                        // new RegisterFromNpm({ namespace: "docs" }).registerPkg(...)
│   ├── io.ts                                          // new RegisterFromNpm({ namespace: "io" }).registerPkg(...)
│   └── workspace.ts                                   // new RegisterFromNpm({ namespace: "workspace" }).registerPkg(...)
└── mcp/
    ├── ai-call-ai/
    │   ├── index.ts                                        // new Register({ namespace: "ai-call-ai" }).register(...)
    │   └── WORKSPACE_AI_CONTACT.ts                         // 保持当前公开 schema、card()、input()
    ├── overview.ts                                         // new Register({ namespace: "todo-mcp2" }).register(...)
    ├── watcher.ts                                          // new Register({ namespace: "watcher" }).register(...)
    └── workcopy/
        └── index.ts                                        // new Register({ namespace: "workcopy" }).register(...)
F:/pro/create-todo-cli/
└── mcpCreate/index.ts                                 // new Register({ namespace: "create-todo-cli" }).register(...)
F:/pro/extends-electron-vite/
└── apps/honoapp/src/
    ├── routers.ts                                    // Mcp.register() 只消费 Register.deliver()
    └── tpl/index.ts                                  // new Register({ namespace: "honoapp" }).register(...)
```

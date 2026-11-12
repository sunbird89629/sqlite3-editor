# Design

## Context

见 `proposal.md`。当前实现的相关约束：

- `ui/main.tsx` 的 `runQuery()` 是查看器执行自定义查询的唯一入口：校验语句前缀、调用 `setViewerQuery({ customViewerQuery })`，失败时把错误放在查询框下方并保留上一次结果。
- `ui/table.tsx` 的 `useTableStore` 保存 `customViewerQuery`、`useCustomViewerQuery`、`pendingQuery`；`pendingQuery` 只把语句填进输入框，不执行。
- 数据区的子页签现在是 `isSchemaViewOpen` 布尔量，只在表格模式渲染（`Data` / `Schema`）。
- 持久化只有一条通道：webview 的 `remote.setState` → 扩展的 `/setState` → `context.workspaceState`；启动时 `/downloadState` 把整份 `workspaceState` 一次性下发给 webview。
- 大字段已经有前缀读取（`LEFT(col, 1024)`），说明这个查看器的数据面很在意单次载荷大小——历史记录的设计也要守住这条线。

## Goals / Non-Goals

**Goals:**

- 记录的写入路径只有一处，写入失败（持久化报错）不影响查询本身。
- 历史可预测：去重、上限、裁剪规则都是纯函数，可单独测试。
- 不新增 webview ↔ 扩展协议，不加依赖。

**Non-Goals:**

- 不保存结果行，不做结果对比；重放即重新查询。
- 不记录 SQL 文档（`.sql`）里的执行（那是另一条路径，见 `vscode/native-query-editor.ts`）。
- 不做跨工作区/全局历史，不做导入导出，不做"收藏"分组。
- 不实现历史条目的编辑：要改语句就在查询框里改，执行后自然产生新条目。

## Decisions

### D1. 历史状态放在独立模块与独立 store

新增 `ui/query-history.ts`：纯逻辑（`push`/`prune`/`summarize`）+ 一个 `createStore` 实例。`main.tsx` 只负责"执行成功后调用 `record()`"，面板只负责渲染。

- 备选：直接塞进 `useTableStore`。会让已有 store 继续膨胀，且历史与表格状态生命周期不同（表格随会话切换，历史跨会话保留）。
- 备选：存在扩展侧的 `workspaceState` 直读。webview 无法直接读，仍要走 `/downloadState`，没有收益。

### D2. 记录点只有 `runQuery()` 成功之后

在 `setViewerQuery` resolve 之后记录，携带 `customViewerQuery`、当前会话的数据库名、`Date.now()`、耗时与 `records.length`。

- `seedQuery()`（菜单把语句放进来）不记录，否则"翻过历史"和"执行过"就混在一起。
- 失败不记录：失败不产生数据，条目里也没有可回看的东西；查询框里本来就保留着失败语句，可以直接改。
- 备选：记录失败并打标记。收益低（语句本来就在输入框），却让"历史"这个词的含义变模糊。

### D3. 去重按"连续相同"而不是全局唯一

只把新条目与**最上面一条**比较（去掉尾部空白与分号后比较）。全局去重会把常用语句压到一条、丢掉"今天也用过"的时间信息；连续去重能挡住"手抖连点两次执行"这种噪声。

### D4. 上限用条数 + 字节双约束

100 条，单条 8,000 字符，总量 256KB，超了从最旧开始丢。

- 只限条数不够：100 条 × 8,000 字符 = 800KB，会显著抬高 `/downloadState` 的启动载荷。
- 只限字节不够：几十条一句话的查询会把总字节数压得很低，用户却看不到"更多历史"。
- 256KB 相对于当前 `workspaceState` 是很小的一块，启动影响可忽略。

### D5. 持久化写入去抖，且失败不影响查询

历史变更后经 300ms 去抖写入 `remote.setState("queryHistory", entries)`；写入失败只在控制台记录，并在面板顶部显示一行"历史未能保存"，不打断查询。

- 备选：每次记录都立即写。执行查询本身已是重操作，多一次写不算贵，但连续执行会连写，去抖能省掉一半。
- 备选：不做持久化（只在内存）。不满足"随时回到"。

### D6. 子页签从布尔量改为三态，Schema 只在表格模式出现

`isSchemaViewOpen: boolean` 换成 `viewerTab: "data" | "schema" | "history"`。`History` 在两种模式下都可见；`Schema` 只在表格模式渲染（查询结果没有稳定表结构）。切到 `History` 时数据区被面板替代，切回 `Data` 恢复原内容，不清空查询草稿。

- 备选：把历史做成弹窗/下拉。空间太小，放不下"语句 + 时间 + 行数 + 筛选"，且不利于后续加删除与清空。

### D7. 重放复用 `runQuery` 的路径，不新增执行通道

点击条目：切到 `Custom query` 模式 → 把语句写入 `customViewerQuery` → 走与手写查询完全相同的执行与校验（客户端白名单 + 服务端只读事务）。因此历史上的语句不可能绕过只读限制。

- 若条目属于别的数据库，不拦截：语句可能本来就跨库可移植，拦截会让"点不动"没有解释；失败时照常报错。
- 历史里存的只是文本，重放会拿到**当前**数据。这一点写在面板说明里，避免"以为回到了当时"。

## Risks / Trade-offs

- [历史里存了含敏感字面量的 SQL（密码、手机号）] → 面板顶部说明"历史明文保存在工作区状态里"；不写入仓库文件，不随扩展分发。后续可加"清除历史"的显眼入口（本次已有一条条删与清空）。
- [`workspaceState` 被别的东西撑大导致启动变慢] → 256KB 上限 + 去抖；启动载荷测量放进验证任务。
- [多窗口同工作区同时写历史，最后一次写入覆盖前一次] → `workspaceState` 由 VS Code 串行化，条目是整表覆盖，最坏情况丢一条；不引入合并冲突处理，记录为已知限制。
- [重放看到的数据与当时不同] → 面板文案与规格都明确"重放即重新查询"。
- [语句被 8,000 字符截断后重放会报语法错误] → 条目显示"已截断"标记；这是有意的取舍，避免无上限的启动载荷。
- [子页签从布尔量改成三态，可能影响既有断言] → 保留 `data-testid="schema-button"`，新增 `history-button`；复查 `viewer_query` 与 `schema_view` 两个 spec。

## Migration Plan

- 纯新增：没有既有状态要迁移；首次启动时 `queryHistory` 不存在，按空数组处理。
- 回滚：删除面板与记录调用即可，残留的 `queryHistory` 键在 `workspaceState` 里无害。

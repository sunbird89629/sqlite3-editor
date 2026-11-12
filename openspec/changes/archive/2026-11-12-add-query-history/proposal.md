# Proposal

## Why

查看器的 `Custom query` 只保留当前那一条语句：换表、切回表格模式、关掉窗口之后，之前写过的查询就找不回来了，只能凭记忆重写。用户需要「随时回到之前的查询」，也就是能翻出过去执行过的语句并一键重跑。

## What Changes

- 新增查询历史：`Custom query` 每次**成功执行**都记一条，包含语句文本、所属数据库、执行时间、耗时与返回行数。
- 新增 `History` 页签（与 `Data` / `Schema` 并列）：列出历史条目，支持关键字筛选、单条删除、清空全部；点击条目即切到 `Custom query` 模式并用该语句重跑。
- 连续执行完全相同（去尾分号后）的语句只保留一条；最多保留 100 条，超出丢最旧。
- 历史按工作区持久化（复用现有 `workspaceState` 通道），重开窗口仍在；单条语句最多存 8,000 字符，总大小超过 256KB 时从最旧开始丢弃。
- **不含**：保存结果行快照（重跑拿到的是最新数据）；不记录 SQL 文档（`.sql`）里执行的语句；不做跨工作区/全局共享；不做导入导出。

## Capabilities

### New Capabilities

- `query-history`: 记录成功执行的只读查询，在 `History` 页签里浏览、筛选、重放与清理，并按工作区持久化。

### Modified Capabilities

- `viewer-query-mode`: 「查询入口的职责区分」允许从历史记录重放只读查询，并把该要求里关于 `More actions` 菜单的过期描述改成当前实际菜单。

## Impact

- 新增 `ui/query-history.ts`：历史状态（新增/去重/上限/裁剪）与持久化；纯函数便于测试。
- `ui/main.tsx`：`runQuery()` 成功后记录一条；`Data`/`Schema`/`History` 子页签由布尔量改为三态；新增历史面板。
- `ui/components.tsx`：复用 `persistentRef` 之外的写入路径，历史写入走 `remote.setState("queryHistory", …)`。
- `ui/style.scss`：历史列表样式。
- `vscode/extension.ts`：不改协议，继续用 `/setState` 与 `/downloadState`；注意启动时整份 `workspaceState` 会随 `/downloadState` 下发，需保证历史不拖慢启动。
- 测试：新增 `ui/tests/query_history.spec.ts`（记录、去重、上限、重放、删除、清空、持久化）；既有 `viewer_query.spec.ts` 与 `schema_view.spec.ts` 的子页签断言需要复查。
- 规格：`openspec/specs/query-history`（新）、`openspec/specs/viewer-query-mode`（修改一条要求）。

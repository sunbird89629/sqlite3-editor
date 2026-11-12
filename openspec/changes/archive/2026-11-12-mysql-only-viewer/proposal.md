# Proposal

## Why

本分支专做 MySQL。当前实现是 SQLite 专属的：会话身份是文件路径，数据面是 `rust-backend` 子进程（62 个文件、约 11k 行 Rust）加一份 Python 回退，UI 里散落 SQLite 方言（`PRAGMA`、`sqlite_master`、`rowid`），而写入功能（单元格编辑、新增记录、表结构编辑）占了 UI 代码的一半以上。只读浏览 MySQL 用不到这些：Rust 需要四平台交叉编译，Python 回退需要版本探测，两套后端行为还要对齐。

## What Changes

**移除**

- `rust-backend/` 整个目录，以及 `vscode/build-rust.cjs`、`vscode/server-min-supported-version.sh`、`vscode/rust_client_test.cjs`、`vscode/rust_test_server.cjs`。
- Python 回退：`vscode/server.py`、`vscode/umsgpack.py`、`vscode/server_test.py`，以及 `sqlite3-editor.pythonPath` 设置与 `findPython()`。
- SQLite 支持：`sqlite3-editor.editor` 自定义编辑器与 `.db`/`.sqlite`/`.sqlite3` 选择器、`fs.watch` + `-wal` 轮询、SQLite 方言查询与 `rowid` 行键。
- 写入功能：单元格编辑（`ui/editor.tsx`、`vscode/cell-editor.ts`）、新增记录（`vscode/insert-editor.ts`、`vscode/insert-draft.ts`）、表结构编辑、`/import` 与 `/export` op。
- 依赖 Rust 分析层的能力：SQL 补全、code lens、语法诊断、`-- params:` 参数绑定（`vscode/query-params.ts`、`vscode/sqlite-keywords.ts`、`ui/sql_completion.tsx`）。
- 依赖 SQLite 的命令与菜单项：`Copy Database`、`Export`/`Import`、PRAGMA 相关菜单项。

**新增**

- 设置 `sqlite3-editor.mysqlConnections`：连接数组，含 `id`、`name`、`host`、`port`、`user`、`password`、`database`。密码明文存放。
- 命令 `SQLite3 Editor: Connect to MySQL`。
- 扩展宿主内的 `mysql2` 客户端与只读网关（首关键字白名单 + `SET SESSION TRANSACTION READ ONLY`）。
- 只读会话面板：表与视图清单、列定义（名称、类型、可空、默认值）、主键与索引、分页/排序/筛选的数据网格、只读查询框。
- `node-http` 改为开发期 MySQL 镜像，服务 vite 开发服务器与 Playwright。

**BREAKING**：扩展不再打开 `.db` 文件，不再是 SQLite 编辑器；会话只能连接到已配置的 MySQL 服务器。

## Capabilities

### New Capabilities

- `mysql-connection`: 配置、建立、关闭只读 MySQL 会话，并在会话内浏览架构与数据、执行只读查询、拒绝写入。

### Modified Capabilities

- `data-grid-pagination`: 行键从 `rowid` 改为单列主键、无主键时退回偏移分页；移除「翻页保护未保存编辑」与「单元格选择与键盘编辑入口」两条要求；外部修改提示改为手动刷新。

`viewer-query-mode` 与 `sql-editor-results` 的要求不变：只读查询框与结果面板在 MySQL 会话中按原要求工作，变化只发生在它们依赖的行键与补全上。

### Removed Capabilities

- `cell-editor`: 写库能力整体移除，同名的 `2026-11-09-strip-cell-editor-chrome` 变更已归档，其要求随本变更废弃。
- `query-completion`: 补全依赖 Rust 分析层，随 Rust 后端一起移除。

## Impact

- 删除：`rust-backend/`（62 个文件）、`vscode/server.py`、`vscode/umsgpack.py`、`vscode/server_test.py`、`vscode/build-rust.cjs`、`vscode/cell-editor.ts`、`vscode/cell-editor-test.cjs`、`vscode/insert-editor.ts`、`vscode/insert-draft.ts`、`vscode/query-params.ts`、`vscode/sqlite-keywords.ts`、`ui/editor.tsx`、`ui/sql_completion.tsx`。
- 重写：`vscode/extension.ts`（480 行 → 连接注册、会话面板、`/query` 路由）、`ui/remote.ts`（去掉 SQLite 方言查询）、`ui/table.tsx`（去掉写入与 `rowid` 路径）、`node-http/server.ts`。
- 新增：`vscode/mysql-client.ts`、`vscode/mysql-guard.ts`、`ui/dialect.ts`（只保留 MySQL 一份实现）。
- 依赖变化：扩展新增 `mysql2`；`node-http` 用 `mysql2` 取代 `better-sqlite3`；`package.json` 去掉 Rust/Python 构建脚本。
- 测试：`ui/tests` 中与写库、补全、SQLite 相关的用例删除；新增 MySQL 用例（依赖 `MYSQL_TEST_URL`，未配置时跳过）。
- 文档：`README.md` 从「SQLite 编辑器」改为「MySQL 只读查看器」，删掉 Rust/Python 安装说明。

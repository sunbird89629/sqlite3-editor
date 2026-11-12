# Tasks

## 1. 移除 Rust 后端与 Python 回退

- [x] 1.1 删除 `rust-backend/`、`vscode/build-rust.cjs`、`vscode/server-min-supported-version.sh`、`vscode/rust_client_test.cjs`、`vscode/rust_test_server.cjs`、`vscode/server.py`、`vscode/umsgpack.py`、`vscode/server_test.py`；验证 `rg -n "rust-backend|server\.py|umsgpack" --glob '!node_modules' --glob '!*.lock'` 只剩待改的 `extension.ts` 引用。
- [x] 1.2 `vscode/extension.ts` 删除 `LocalPythonClient`、`findPython()`、`supportedPythonVersion`/`supportedSQLiteVersion`、`pythonPath` 设置与相关 `spawn` 调用；验证 `cd vscode && npx tsc --noEmit` 报错全部指向已知的待删模块（cell-editor、insert-editor、native-query-editor），无其他新增错误。
- [x] 1.3 `vscode/package.json` 删除 `sqlite3-editor.pythonPath` 设置、Rust/Python 构建脚本与 `which`、`tempy` 依赖；验证 `cd vscode && npm i && node build-extension.cjs` 成功打包 `extension.js`。

## 2. 移除写功能

- [x] 2.1 删除 `vscode/cell-editor.ts`、`vscode/cell-editor-test.cjs`、`vscode/insert-editor.ts`、`vscode/insert-draft.ts`、`vscode/insert-draft-test.cjs`、`vscode/insert-editor-test.cjs`、`vscode/insert-editor-host-test.cjs`、`vscode/insert-editor-restart-host-test.cjs`；验证 `extension.ts` 中 `registerInsertEditor`、`registerCellEditor` 调用已删除，`tsc --noEmit` 无相关错误。
- [x] 2.2 删除 `vscode/package.json` 中 `sqlite3-editor.insert` 自定义编辑器与 `.sqlite-insert-draft` 选择器；验证 `node build-extension.cjs` 后 `extension.js` 内不再出现 `sqlite-insert-draft`。
- [x] 2.3 `ui/editor.tsx` 整体删除，`ui/table.tsx` 删除写入、`editorStatus`、`openCellDraft`/`closeCellDraft`/`setCellDraftText` 相关路径与「新增记录」入口；验证 `cd ui && npx tsc --noEmit` 无新增错误。
- [x] 2.4 删除 `ui/tests/z_cell_detail.spec.ts`、`ui/tests/insert_draft.spec.ts` 以及与写库相关的断言；验证 `cd ui && npx playwright test` 中剩余用例通过（记录基线）。
- [x] 2.5 `extension.ts` 删除 `/import`、`/export`、`/openInsertEditor`、`/guardInsertEditor`、`/openCellInEditor`、`/openRowInEditor`、`/openCellDraft`、`/setCellDraftText`、`/closeCellDraft`、`/openTerminal` op，与 `node-http` 的同名端点一起删除；验证 `rg -n "openCellDraft|openInsertEditor|/import|/export" vscode ui node-http --glob '!node_modules'` 无残留。

## 3. 移除依赖 Rust 的分析能力

- [x] 3.1 删除 `vscode/query-params.ts`、`vscode/query-params-test.cjs`、`vscode/sqlite-keywords.ts`、`ui/sql_completion.tsx`、`ui/tests/sql_completion.spec.ts`、`ui/tests/query_editor.spec.ts` 中依赖补全的断言；验证 `rg -n "query-params|sqlite-keywords|sql_completion" vscode ui --glob '!node_modules'` 无残留。
- [x] 3.2 `vscode/native-query-editor.ts` 只保留打开、保存、执行与「Open in SQL Editor」交接，删除 code lens、诊断集合、补全提供者与 `hasRust` 分支；验证文件不再引用 `hasRust`，`tsc --noEmit` 通过。
- [x] 3.3 验证降级行为：`cd ui && npx playwright test` 中 SQL 编辑器与查询框相关用例通过，不出现补全请求；`npm run test:vscode`（pytest 已删）改为 `cd vscode && node extension_test.cjs` 并通过。

## 4. MySQL 客户端与只读网关

- [x] 4.1 新增 `vscode/mysql-guard.ts`：剥离注释与字符串字面量后做首关键字白名单（`SELECT`/`SHOW`/`DESC`/`DESCRIBE`/`EXPLAIN`，`WITH` 仅在剩余部分不含 `UPDATE`/`DELETE`/`INSERT` 时放行）；验证单元测试覆盖 `/*!50000 DELETE ... */`、`WITH x AS (SELECT 1) DELETE FROM t`、大小写混写、多语句堆叠均被拒绝，`SELECT`/`SHOW TABLES` 放行。
- [x] 4.2 新增 `vscode/mysql-client.ts`：`mysql2/promise`，选项按 design D4，连接后执行 `SET SESSION TRANSACTION READ ONLY`；`query()` 先过 `mysql-guard`，返回 `{ columns, records }`；验证桩连接测试断言选项、只读语句已发送、写语句未到达驱动。
- [x] 4.3 `node-http/server.ts` 用 `mysql2` 替换 `better-sqlite3`，复用 `mysql-guard`；验证 `curl -X POST /query`：`SELECT` 返回 `{columns, records}`，`DELETE` 返回 400 且含只读限制文本。

## 5. 连接配置、命令与会话面板

- [x] 5.1 `vscode/package.json` 增加 `sqlite3-editor.mysqlConnections`（数组，`id`/`name`/`host`/`port`/`user`/`password`/`database`，密码字段带明文风险说明）与命令 `SQLite3 Editor: Connect to MySQL`；验证命令出现在命令面板，设置项在设置 UI 可编辑。
- [ ] 5.2 `extension.ts` 实现连接选择器与校验：缺少 `id`/`host`/`database` 的条目被省略；验证手动测试——两个有效条目加一个缺 `host` 的条目，选择器只显示前两个。
- [ ] 5.3 实现会话面板：key 为 `mysql:<connectionId>:<database>`，`createWebviewPanel` 复用现有 webview 与 `/query` 路由，顶部显示连接名、数据库名与降级提示；验证手动测试连接成功、重复连接聚焦原面板、认证失败显示错误且不渲染数据区三条路径。
- [ ] 5.4 关闭面板时关闭连接；验证关闭后 `SHOW PROCESSLIST` 中该连接消失，重新打开建立新连接。
- [x] 5.5 连接被 `wait_timeout` 断开时提示「连接已断开」并提供重连；验证服务器侧 `KILL` 该连接后查询出现提示与重连按钮，重连后查询恢复。

## 6. UI 方言收敛与 MySQL 数据浏览

- [x] 6.1 新增 `ui/dialect.ts`（只有 MySQL 一份实现）：标识符反引号、`LIMIT ? OFFSET ?` 片段、关键字筛选表达式（`CAST(... AS CHAR)` + `ESCAPE`）、表清单（`information_schema.TABLES`）、列（`COLUMNS`，展示 `COLUMN_TYPE`）、主键与索引（`STATISTICS`）、行键策略；验证有测试库时表选择器列出全部表与视图，列类型与 `SHOW CREATE TABLE` 一致。
- [x] 6.2 `ui/remote.ts` 删除 `PRAGMA`/`sqlite_master` 查询，改为调用方言层；验证文件中不再出现 `PRAGMA` 或 `sqlite_master`。
- [x] 6.3 `ui/table.tsx` 用 `rowKeyColumn` 取代 `hasRowId`，`escapeSQLIdentifier` 改用反引号，删除写入路径与 `sqlite3_master` 相关分支；验证单列主键表发锚点分页、无主键表只发偏移分页（查看看板网络请求）。
- [x] 6.4 新增 Playwright 用例：23 条记录翻到第 3 页显示 21–23、跨页排序、跨页筛选、写语句被拒且保留上次结果、双击不进入编辑；测试库由 `MYSQL_TEST_URL` 提供，未配置时跳过；验证 `cd ui && npx playwright test` 在配置测试库时这些用例通过、未配置时跳过而非失败。

## 7. 元数据与文档

- [x] 7.1 `vscode/package.json` 更新 `displayName`、`description`、`keywords`、`categories`、`activationEvents`（去掉 `*.db` 相关声明），删除 `sqlite3-editor.editor` 自定义编辑器；验证 `node build-extension.cjs` 后 `extension.js` 不含 `.sqlite3` 选择器，`.db` 文件不再被本扩展接管。
- [x] 7.2 重写 `README.md`：MySQL 只读定位、配置示例、只读范围、不支持的功能（补全、code lens、诊断、写操作、外部修改自动检测）、安装与开发命令；验证按文档中的配置示例粘贴后可成功连接。
- [x] 7.3 删除 `docs/rust-backend-integration.md` 与根目录中仅用于 SQLite 演示的截图/动图引用；验证 `README.md` 中不存在指向已删文件的链接。

## 8. 集成验证

- [x] 8.1 运行 `cd ui && npx tsc --noEmit && npx playwright test`、`cd vscode && npx tsc --noEmit && node build-extension.cjs`、`cd node-http && npm start`，三项全部成功。
- [ ] 8.2 手动端到端：配置连接 → 打开会话 → 浏览表与列 → 排序筛选翻页 → 只读查询 → 提交 `DELETE` 被拒 → 关闭面板；验证每步与 `mysql-connection` 规格场景一致。
- [x] 8.3 验证 `rg -n "sqlite|PRAGMA|rowid|rust" --glob '!node_modules' --glob '!openspec/**' --glob '!package-lock.json'` 的剩余命中都是有意保留的（README 说明、`openspec` 归档、测试数据），无死代码引用。

## Workflow follow-up

- 同步 delta 到主规格并归档；归档后删除被清空的 `openspec/specs/cell-editor`、`openspec/specs/query-completion`。
- 归档后按仓库惯例发布下一版，并在发布说明中标注 BREAKING（不再支持 SQLite 与写入）。

# Design

## Context

见 `proposal.md`。当前实现的约束：

- 会话身份是文件路径。`vscode/extension.ts` 的 `openCustomDocument` 用 `uri.fsPath` 作 key，写入 `queryEditor.addConnection`、`insertEditor`、`cellEditor` 三处注册表，并起 `fs.watch` + `-wal` mtime 轮询。
- 数据面是 `rust-backend` 子进程（msgpack 请求/响应文件 + stdin 命令），由 `LocalPythonClient` 门面调用；没有 Rust 二进制时回退到 `vscode/server.py`（Python `sqlite3`）。
- `node-http/server.ts`（Express + `better-sqlite3`）镜像扩展宿主的 op switch，只服务 `ui` 的 vite 开发服务器与 Playwright。
- UI 直接构造 SQLite 方言 SQL（`PRAGMA table_info`、`sqlite_master`、`rowid`、双引号标识符、`CAST(... AS TEXT)`），且写入逻辑与浏览逻辑混在 `ui/table.tsx` 与 `ui/editor.tsx`。

## Goals / Non-Goals

**Goals:**

- 运行期只有一种语言：Node。扩展 = 一个 Node 进程（扩展宿主）+ 一个 webview bundle。
- 删除的代码不留半死的入口：没有 Rust 就删掉补全、code lens、诊断、导入导出、写入。
- 只读浏览的实现路径短到可以直接读：`ui` → `vscode` → `mysql2` → 服务器，中间没有子进程、没有临时文件。

**Non-Goals:**

- 不保留 SQLite 兼容层，不保留「以后加回写功能」的空壳。
- 不做连接池、多库同时浏览、SSH 隧道、TLS 证书配置、SSL 证书校验选项。
- 不替换 `msgpackr` 的 webview 通道（它在两条路径上都在用，替换不减少复杂度）。
- 不在本变更内提升补全能力（例如接入本地 SQL 词法分析器）；降级提示即可。

## Decisions

### D1. 数据面放在扩展宿主内，用 `mysql2`

`vscode/mysql-client.ts` 持有一个 `mysql2/promise` 连接，暴露 `query(sql, params)` 与 `close()`，由 `extension.ts` 的 `/query` op 调用。`node-http/server.ts` 用同一份 `mysql-guard` 与相同查询路径实现开发镜像。

- 备选 A：保留子进程，只是把 Rust 换成 Node 脚本。多一层进程编排、端口或 msgpack 文件协议、生命周期与重连，收益仅是隔离，而扩展宿主本来就是 Node。
- 备选 B：Rust 新增 MySQL 模块（`sqlx`）。能保住补全与 code lens，但要维护四平台交叉编译与 11k 行 Rust，与「技术栈简单」直接冲突。
- 备选 C：扩展内嵌启动 `node-http`，UI 全程走 HTTP。开发与生产同一条路径，但引入端口分配、CORS、令牌与生命周期管理；而 webview 的 `postMessage` 通道已经存在且可用。

代价：补全、code lens、诊断、参数绑定永久消失。这是明确的取舍，用会话面板的降级提示与 README 说明覆盖。

### D2. 会话身份用虚拟 key，不走 custom editor provider

key 为 `mysql:<connectionId>:<database>`；面板用 `vscode.window.createWebviewPanel` 创建，复用现有 webview 资产与 op switch。

- 备选：注册 `mysql://` URI 的 `TextDocumentContentProvider` + custom editor。custom editor 需要可打开的文档 URI，而现有 `openCustomDocument` 把 `uri.fsPath` 当数据库路径，还要保留 `fs.watch` 与 `-wal` 轮询的假路径分支，改动比新建面板更大。

### D3. 只读用客户端白名单 + 服务端只读事务

- 客户端：剥离注释与字符串字面量后对首关键字做允许列表（`SELECT`、`SHOW`、`DESC`/`DESCRIBE`、`EXPLAIN`；`WITH` 仅在剩余部分不含 `UPDATE`/`DELETE`/`INSERT` 时放行）。`mysql2` 的 `multipleStatements` 保持 `false`。
- 服务端：连接后执行 `SET SESSION TRANSACTION READ ONLY`。

两层都很便宜，叠加后覆盖「客户端漏判」与「注释/大小写绕过」两种失败模式。仅用白名单会被 `/*!50000 DELETE ... */` 这类版本注释绕过；仅用服务端只读对 DDL 与临时表的语义不够确定。

### D4. 类型映射字符串优先

`mysql2` 选项：`supportBigNumbers`、`bigNumberStrings`、`dateStrings`，`decimalNumbers: false`。`BIGINT`/`DECIMAL`/`DATETIME` 以字符串过线，`BIT`/`BLOB` 走 `Buffer`。网格的单元格值类型保持 `string | number | bigint | Uint8Array | null`，不需要新的序列化格式。

### D5. 行键：单列主键优先，否则退回偏移分页

`ui/table.tsx` 的 `hasRowId` 换成 `rowKeyColumn: string | null`，由 `ui/dialect.ts` 从 `information_schema.STATISTICS` 推导：

- 单列主键 → 锚点分页（`key > ?`），与现有 `rowid` 路径同构。
- 复合主键或无主键 → `LIMIT ? OFFSET ?`，不注入 `ORDER BY`，保留结果自然顺序。

不做「复合主键拼行值比较」：收益只是省一次计数扫描，与只读阶段的价值不匹配。

### D6. 删除顺序按依赖从叶子到根

每个删除批次都必须留下可编译、可测的状态，顺序为：

1. `rust-backend/`、Python 回退、Rust/Python 构建脚本与它们的测试。
2. 写功能叶子：`vscode/cell-editor.ts`、`vscode/insert-editor.ts`、`vscode/insert-draft.ts`、`ui/editor.tsx` 及相关 UI 入口。
3. 依赖 Rust 的分析能力：`vscode/query-params.ts`、`vscode/sqlite-keywords.ts`、`ui/sql_completion.tsx`、`native-query-editor.ts` 中的 code lens / 诊断 / 补全。
4. 重写 `extension.ts`（连接注册与会话面板）与 `ui/remote.ts`、`ui/table.tsx`（只剩一种方言）。

反过来的顺序（先重写 UI 再删 Rust）会让中间态既不能编译也不能验证。

### D7. 保留扩展标识 `yy0931.vscode-sqlite3-editor`

`vscode/package.json` 的 `name` 保持 `vscode-sqlite3-editor`，只改 `displayName`、`description`、`keywords`。理由：这是原有升级通道，改动 `name` 会变成 marketplace 上的新扩展，旧用户既收不到升级，也不会被替代。

代价：现有 SQLite 用户升级后会失去打开 `.db` 的能力，属破坏性升级，发布说明必须标注。命令与设置前缀保持 `sqlite3-editor.*`，与旧设置命名空间一致。

- 备选：改用 `yy0931.vscode-mysql-viewer` 作为独立产品。用户不必被破坏性升级影响，但等于放弃已有安装量，且两套扩展并存。

### D8. 明文密码

按用户决定，密码与主机同一份设置里明文存放。设置项的 `markdownDescription` 说明可被 Settings Sync 同步或提交进仓库的风险。

## Risks / Trade-offs

- [删除 11k 行 Rust 后失去补全与诊断，用户感知为功能退步] → 会话面板常驻降级提示；README 在支持范围里写明；不静默缺失。
- [删除写功能使扩展不能编辑任何数据] → 明确的产品取舍；发布说明标注 BREAKING，并提示用户使用专门的数据库客户端。
- [一个删除批次后中间态无法编译] → 用 D6 的叶子优先顺序，每批结束跑 `tsc --noEmit` 与 `node build-extension.cjs`。
- [明文密码泄露] → 设置项描述提示；后续可迁 SecretStorage，届时保留明文回退。
- [沿用旧标识意味着破坏性升级] → 发布说明标注不再支持 SQLite 与写入；版本号升到 4.0.0。
- [大表 `COUNT(*)` 慢] → 沿用现有计数分页；`information_schema.TABLES.TABLE_ROWS` 是估算值，不采用。
- [会话被 `wait_timeout` 断开] → 查询报连接错误时提示「连接已断开」并提供重连。
- [Playwright 需要真实 MySQL] → `MYSQL_TEST_URL` 提供测试库，未配置时相关用例跳过，不阻塞既有套件。
- [删掉 `better-sqlite3` 后 `npm start` 的旧脚本失效] → 同一批次改 `node-http` 的依赖与启动脚本，保证 `npm start` 仍能起开发环境。

## Migration Plan

- 分支未推送，回滚即 `git revert` 或丢弃分支。
- 批次顺序：删 Rust/Python → 删写功能 → 删分析能力 → 接 MySQL 会话 → UI 方言收敛 → `node-http` 镜像 → 文档与 `package.json` 元数据（`displayName`、`description`、`keywords`、`activationEvents`）。
- 无数据迁移：设置项为新增，旧设置 `pythonPath` 删除后由 VS Code 自动忽略。

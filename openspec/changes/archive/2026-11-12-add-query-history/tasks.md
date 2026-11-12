# Tasks

## 1. 历史状态与纯逻辑

- [x] 1.1 新增 `ui/query-history.ts`：`HistoryEntry`（`sql`/`database`/`executedAt`/`durationMs`/`rows`/`truncated`）、`push()`（连续去重、最新在前）、`prune()`（100 条 / 8,000 字符 / 256KB）、`summarize()`（单行摘要）与 `createStore` 实例；验证：`page.evaluate` 里导入模块，断言连续重复只留一条、第 101 条挤掉最旧、长语句被截断并置 `truncated`、超大总量从最旧丢弃。
- [x] 1.2 启动时从 `remote.getState("queryHistory")` 载入；缺失或形状不对时按空历史处理；验证：手动写入一段非法形状的状态后重载页面，`History` 页签显示空状态且控制台无异常。

## 2. 记录执行

- [x] 2.1 `ui/main.tsx` 的 `runQuery()` 在 `setViewerQuery` 成功后调用 `record()`，带上会话数据库名、耗时与行数；验证：在 `Custom query` 执行 `SELECT 1` 后打开 `History`，出现一条 `SELECT 1`、行数 1 的记录。
- [x] 2.2 失败与"只填入不执行"都不产生记录；验证：执行 `SELECT * FROM missing_table` 报错后条目数不变；从 `More actions` 的 `Describe Columns in Query Mode` 填入语句但不执行，条目数不变。

## 3. History 页签

- [x] 3.1 把 `isSchemaViewOpen` 换成三态 `viewerTab`（`data` / `schema` / `history`），`History` 在表格与查询模式下都可见，`Schema` 只在表格模式渲染；保留 `data-testid="schema-button"`，新增 `history-button`；验证：`ui/tests/schema_view.spec.ts` 与 `ui/tests/viewer_query.spec.ts` 仍通过。
- [x] 3.2 实现历史面板：倒序列表、语句摘要（单行、超长省略）、数据库、时间、耗时、行数、筛选框、空状态、条目数统计；验证：新增 Playwright 用例覆盖列表顺序、筛选命中与空状态。
- [x] 3.3 面板顶部说明"重放得到的是当前数据，历史明文保存在工作区状态里"；验证：面板可见该说明（`data-testid="history-note"`）。

## 4. 重放、删除与清空

- [x] 4.1 点击条目：切到 `Custom query` 模式并执行该语句，复用现有 `runQuery` 校验；验证：点击一条 `SELECT` 记录后查询框内容为该语句、数据区显示结果；点击一条写入型记录（人为构造）时被只读校验拒绝且条目不变。
- [x] 4.2 单条删除；验证：删除后条目消失、其余顺序不变，重载页面后仍不在。
- [x] 4.3 清空全部先确认，取消保留；验证：取消后条目数不变，确认后列表为空且重载页面仍为空。

## 5. 持久化

- [x] 5.1 变更后 300ms 去抖写入 `remote.setState("queryHistory", entries)`，写入失败在面板显示提示且不影响查询；验证：执行一条查询后等待 1s，`/downloadState` 返回的 `queryHistory` 含该条；把 `/setState` 人为改成失败（临时桩）时面板出现提示且查询结果照常显示。
- [x] 5.2 重开窗口后历史仍在；验证：执行两条查询，重载页面（`page.reload()`），`History` 仍显示这两条。

## 6. 样式与文档

- [x] 6.1 `ui/style.scss` 增加历史面板样式（列表行、摘要等宽字体、时间与行数的次要文字、空状态），窄窗口下不横向溢出；验证：420px 视口下无横向滚动条。
- [x] 6.2 `README.md` 增加"查询历史"小节：记录什么、上限、重放拿到最新数据、保存在工作区状态里；验证：按文档描述能在界面里逐条对上。

## 7. 集成验证

- [x] 7.1 运行 `npm test`（vscode 单测 + Playwright 全套），确认既有 24 项与新用例全部通过；记录通过数与耗时。
- [ ] 7.2 手动走一遍：执行三条查询 → 打开 `History` → 筛选 → 重放一条 → 删除一条 → 清空 → 重开窗口确认仍为空；验证：结果与 `query-history` 规格场景一致。

## Workflow follow-up

- 同步 delta 到主规格并归档。
- 归档后按仓库惯例打包（`vscode:prepublish` 走生产构建）并安装到目标 profile 验证。

# Rust 后端源码基线

`rust-backend/` 保存公开的 `yy0931/sqlite3-editor` 的 `rust-backend` 分支源码，基线为提交 `8be10de9499e7a83900b9e8da1f59306bf55aa69`（1.0.213）。该分支与本项目原有 `main` 没有共同 Git 历史，因此通过保留两条历史的合并引入。

当前 `ui/` 和 `vscode/` 是原有前端与 VS Code 扩展。扩展通过适配层使用本机平台的 Rust 服务，将现有请求转换为 1.0.213 的服务协议，并将列式结果转换回表格协议。构建时需要 Rust 和 Cargo，脚本生成当前平台与架构的可执行文件并放入 VSIX；没有匹配二进制的平台会回退到原有 Python `vscode/server.py`。因此单个平台构建不应被当作所有平台的 Rust 包发布。

VS Code 数据库编辑器中的 **SQL Editor** 在旁边打开原生 SQL 文件，首行 `-- database: 绝对路径` 关联已打开的数据库；可用 VS Code 正常保存并重新打开。Rust 后端提供表和字段补全、语法诊断以及逐条语句的执行入口；查询结果在数据库面板显示，最多展示前 500 行。SQL 仍在后端完整执行，当前没有对大型结果集分页，避免运行返回大量数据的查询。写入语句须点击其专用执行入口。含参数的语句由语句上方的 `-- params:` 注释行提供值（见「SQL 编辑器的参数」一节）；事务脚本以及没有 Rust 二进制时的这些语言功能目前不支持。浏览器开发模式保留内嵌基础编辑器。商店版 1.0.214 的完整前端源码未包含在公开分支中，因此本实现与商店版并非完全一致。

## SQL 编辑器的参数

带 `?`、`?NNN`、`:name`、`$name` 或 `@name` 的语句从紧贴在语句上方的注释行取值，不再弹出输入框：

```sql
-- database: /Users/hao/app.db
-- params: cid = 'abc', session = 42

SELECT * FROM run_list_projection p JOIN runs r ON r.id = p.run_id
WHERE p.cid = :cid OR p.session_id = :session
ORDER BY r.ROWID;
```

规则：

- 值行只接受 `name = 字面量` 形式。命名占位符可省略 `:`、`$`、`@` 前缀；匿名 `?` 与 `?NNN` 用 SQLite 的参数序号（`?1`、`?2`…）引用。
- 字面量支持 `42`（INTEGER）、`2.5`（REAL）、`'it''s'`（TEXT）、`NULL`、`x'00ff'`（BLOB）。整数按 64 位有符号整数绑定，超出范围直接报错；`42` 是 INTEGER，`42.0` 才是 REAL，`'42'` 是 TEXT。
- 生效范围：普通语句取「紧邻上方的注释块」里最后一条 `-- params:`，中间允许空行与其他注释，遇到代码行即停止；CTE 语句（`▶ Select <名称>`）取该行之前最近的一条定义。
- 缺值、名字写错、字面量非法、同名重复定义都会在发送请求前报错并中止，不会执行语句。参数个数、类型与名字的校验全部在前端完成。
- 参数值会随 SQL 文件一起保存，注意不要把敏感值写进会被提交的文件。

查询文件也提供 SQLite 关键词补全，该功能不依赖 Rust 后端或数据库连接；仅对首行含 `-- database: 路径` 的 SQL 文档启用。

查询结果的列名需要唯一：Rust 服务使用列名作为结果映射的键，重复列名会丢失数据，应在 SQL 中为各列指定不同的别名。写入语句的 `RETURNING` 结果目前不会显示。

分别在仓库根目录运行前端和 Python 检查，在 `rust-backend/` 运行 `cargo test --locked`。构建扩展和 Rust 后运行 `node vscode/rust_client_test.cjs` 可以验证真实 Rust 进程的协议、数据类型及只读约束；`node vscode/query-params-test.cjs` 覆盖 `-- params:` 的解析与绑定（纯函数，不需要数据库）。`vscode/rust_test_server.cjs` 是仅供浏览器测试的适配层测试服务器。上游 Rust CI 文件保存在 `rust-backend/.github/workflows/`，仅作参考，不会作为本仓库 GitHub Actions 工作流自动运行。

根目录 `LICENSE` 与 `rust-backend/LICENSE` 内容不同，分别保留；使用 Rust crate 前请阅读其许可证内容。

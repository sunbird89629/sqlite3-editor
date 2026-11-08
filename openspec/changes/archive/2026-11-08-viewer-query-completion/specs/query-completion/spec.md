# query-completion Specification

## ADDED Requirements

### Requirement: 输入时给出候选

查询框 SHALL 在光标前的标识符至少有 2 个字符时显示补全列表，并 SHALL 在用户按 Ctrl+Space 时无条件显示。候选 SHALL 包含当前表的列、语句中 FROM/JOIN/UPDATE/INTO 引用的表的列、数据库中的表名，以及 SQL 关键字；列与表 SHALL 排在关键字之前，同一组内按名称排序，列表最多 8 项。

#### Scenario: 输入列名前缀
- **WHEN** 用户在 `SELECT * FROM t WHERE ` 后输入 `cre`
- **THEN** 列表显示 `t` 的以 `cre` 开头的列，且第一项为选中状态

#### Scenario: 引用其他表的列
- **WHEN** 语句中出现 `FROM other_table`，用户随后输入该表的列名前缀
- **THEN** 列表包含 `other_table` 的列，即使当前表不含该列

#### Scenario: 关键字
- **WHEN** 用户输入 `WHER`
- **THEN** 列表包含 `WHERE`

#### Scenario: 前缀太短
- **WHEN** 用户只输入 1 个字符
- **THEN** 不自动显示列表

### Requirement: 键盘操作

列表打开时，上下方向键 SHALL 移动选中项并在两端回绕，Enter 或 Tab SHALL 用选中项替换光标前的标识符前缀并关闭列表，Escape SHALL 关闭列表且保留文本与焦点。左右方向键 SHALL 关闭列表。

#### Scenario: Enter 接受
- **WHEN** 列表打开且用户按 Enter
- **THEN** 当前选中项替换前缀，列表关闭，光标停在被插入文本之后

#### Scenario: Escape 关闭
- **WHEN** 列表打开且用户按 Escape
- **THEN** 列表关闭，查询文本不变，光标仍在查询框中

#### Scenario: 点击选择
- **WHEN** 用户点击列表中的一项
- **THEN** 该项被插入，查询框保持焦点

### Requirement: 转到 SQL 编辑器

查询模式 SHALL 在 VS Code 环境中提供 Open in SQL Editor 操作，把当前表的名称与查询框中的文本作为草稿交给 SQL 编辑器；SQL 文档 SHALL 用该草稿替代默认的 `SELECT * FROM` 语句。草稿为空时 SHALL 仍使用默认语句。非 VS Code 环境 SHALL 不显示该操作。

#### Scenario: 带草稿打开
- **WHEN** 用户在查询框中写好语句并点击 Open in SQL Editor
- **THEN** 打开一个 SQL 文档，其正文为该草稿，数据库注释行指向当前数据库

#### Scenario: 空草稿
- **WHEN** 查询框为空时点击 Open in SQL Editor
- **THEN** SQL 文档使用默认的 `SELECT * FROM "表名";`

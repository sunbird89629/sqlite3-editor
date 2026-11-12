# Spec Delta

## ADDED Requirements

### Requirement: 转到 SQL 编辑器

查询模式 SHALL 在 VS Code 环境中提供 Open in SQL Editor 操作，把当前表的名称与查询框中的文本作为草稿交给 SQL 编辑器；SQL 文档 SHALL 用该草稿替代默认的 `SELECT * FROM` 语句。草稿为空时 SHALL 仍使用默认语句。非 VS Code 环境 SHALL 不显示该操作。

#### Scenario: 带草稿打开
- **WHEN** 用户在查询框中写好语句并点击 Open in SQL Editor
- **THEN** 打开一个 SQL 文档，其正文为该草稿，数据库注释行指向当前会话

#### Scenario: 空草稿
- **WHEN** 查询框为空时点击 Open in SQL Editor
- **THEN** SQL 文档使用默认的 `SELECT * FROM` 语句，表名按 MySQL 标识符引用规则加反引号

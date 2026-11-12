# Spec Delta

## MODIFIED Requirements

### Requirement: 查询入口的职责区分

只读查询 SHALL 只通过模式开关或历史记录重放进入；可写 SQL SHALL 只通过 SQL Editor 进入。表操作菜单 SHALL NOT 提供与只读查询同名可写的入口。

#### Scenario: 表操作菜单
- **WHEN** 用户打开 More actions 菜单
- **THEN** 菜单包含 Schema、Refresh、Copy Table Name 与 Describe Columns，不包含可写的 Custom Query 入口

#### Scenario: 从历史重放
- **WHEN** 用户在 `History` 页签点击一条历史条目
- **THEN** 查看器切到 `Custom query` 模式并执行该只读语句，写入型语句仍然被拒绝

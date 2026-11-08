# sql-editor-results Specification

## Purpose

呈现在原生 SQL 编辑器中执行语句后返回的结果：让用户看到行数与列、把结果复制出去，并能关闭面板。

## Requirements

### Requirement: SQL 编辑器结果面板

在原生 SQL 编辑器执行语句后返回的结果 SHALL 显示在数据区，SHALL 标明行数、在结果超过上限时说明只显示前若干行，并 SHALL 提供复制为 CSV、复制为 JSON 和关闭操作。

#### Scenario: 显示查询结果
- **WHEN** 用户在 SQL 编辑器中执行返回行的语句
- **THEN** 数据区出现结果面板，显示列、行数和数据

#### Scenario: 复制结果
- **WHEN** 用户在结果面板选择复制为 CSV 或 JSON
- **THEN** 结果按所选格式写入剪贴板

#### Scenario: 关闭结果
- **WHEN** 用户关闭结果面板
- **THEN** 面板消失，数据区恢复原有内容

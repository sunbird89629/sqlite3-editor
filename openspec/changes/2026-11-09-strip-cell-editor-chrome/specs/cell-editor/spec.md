# Spec Delta

## MODIFIED Requirements

### Requirement: 值在右侧编辑区

在 VS Code 中编辑非 BLOB 单元格时，单元格的值 SHALL 在 webview 右侧的编辑区中打开为一份草稿文档，编辑面板 SHALL NOT 再渲染值输入区。草稿文档的语言在值可解析为 JSON 时为 JSON，否则为纯文本。

#### Scenario: 打开单元格
- **WHEN** 用户在表格中进入某个单元格的编辑状态
- **THEN** 右侧编辑区打开该单元格的草稿页签，光标就位，面板只显示值类型与操作按钮

#### Scenario: JSON 值的格式化
- **WHEN** 单元格的值是合法 JSON
- **THEN** 草稿页签以 JSON 语言打开，内容按两空格缩进显示，格式化由编辑区负责

### Requirement: 草稿页签的生命周期

草稿页签 SHALL 反映草稿是否与打开时的值不同：不同时标记为未保存。保存文档 SHALL 只写入本地草稿，SHALL NOT 写数据库。关闭页签 SHALL 保留草稿内容。

#### Scenario: 保存草稿
- **WHEN** 用户在草稿页签中按保存快捷键
- **THEN** 草稿写入本地存储，数据库不变；再次打开同一单元格时恢复该草稿

#### Scenario: 页签被关闭
- **WHEN** 用户关闭草稿页签
- **THEN** 草稿内容不丢失，面板的 `Commit` 仍可提交该内容

## ADDED Requirements

### Requirement: 面板只保留类型与操作

单元格编辑面板 SHALL NOT 显示单元格身份（表名、列名、行选择器）、保存状态字样或说明值位置的提示条。面板 SHALL 只显示值类型单选组、`Commit` / `Cancel` 与类型为 NULL 或 DEFAULT 时的说明行。

#### Scenario: 编辑单元格时的面板内容
- **WHEN** 用户在 VS Code 中进入某个单元格的编辑状态
- **THEN** 面板只出现值类型单选组与 `Commit` / `Cancel`，不出现表名、列名、Row 选择器、`● Saved` 字样与提示条

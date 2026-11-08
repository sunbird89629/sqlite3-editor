# Spec Delta

## ADDED Requirements

### Requirement: 值在右侧编辑区

在 VS Code 中编辑非 BLOB 单元格时，单元格的值 SHALL 在 webview 右侧的编辑区中打开为一份草稿文档，编辑面板 SHALL NOT 再渲染值输入区。草稿文档的语言在值可解析为 JSON 时为 JSON，否则为纯文本。

#### Scenario: 打开单元格
- **WHEN** 用户在表格中进入某个单元格的编辑状态
- **THEN** 右侧编辑区打开该单元格的草稿页签，光标就位，面板显示表、列、行与值类型

#### Scenario: JSON 值的格式化
- **WHEN** 单元格的值是合法 JSON
- **THEN** 草稿页签以 JSON 语言打开，内容按两空格缩进显示，格式化由编辑区负责

### Requirement: 草稿页签的生命周期

草稿页签 SHALL 反映草稿是否与打开时的值不同：不同时标记为未保存。保存文档 SHALL 只写入本地草稿，SHALL NOT 写数据库。关闭页签 SHALL 保留草稿内容，并提供重新打开的入口。

#### Scenario: 保存草稿
- **WHEN** 用户在草稿页签中按保存快捷键
- **THEN** 草稿写入本地存储，数据库不变；再次打开同一单元格时恢复该草稿

#### Scenario: 页签被关闭
- **WHEN** 用户关闭草稿页签
- **THEN** 面板显示"草稿页签已关闭，内容仍保留"并可重新打开，内容不丢失

## MODIFIED Requirements

### Requirement: 取消单元格编辑

取消单元格编辑 SHALL 放弃未提交的内容、清除单元格选择并收起编辑面板；在 VS Code 中 SHALL 同时关闭草稿页签并删除本地草稿。SHALL NOT 直接展示"新增记录"表单。

#### Scenario: 取消后收起
- **WHEN** 用户在单元格编辑状态下点击取消
- **THEN** 未提交内容被放弃、草稿页签关闭、选中被清除、面板收起；展开后才显示可用的编辑入口

### Requirement: 保存反馈

写入成功后，编辑面板 SHALL 显示短暂的确认信息，并在数秒后自动消失；草稿页签 SHALL 同时关闭。写入失败时 SHALL NOT 显示该确认，SHALL NOT 关闭草稿页签或丢弃其内容。

#### Scenario: 提交成功
- **WHEN** 用户提交一条成功的修改
- **THEN** 面板标题栏显示确认信息并自动消失，草稿页签关闭

#### Scenario: 提交失败
- **WHEN** 写入数据库失败
- **THEN** 面板显示错误，草稿页签与内容保留，可直接重试

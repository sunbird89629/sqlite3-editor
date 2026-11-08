# Spec Delta

## MODIFIED Requirements

### Requirement: 查询只在显式请求时执行

查看器的查询 SHALL 仅在用户点击执行按钮或按下 Ctrl+Enter 时执行。编辑或失焦 SHALL NOT 触发查询。执行时 SHALL 接受末尾带分号的语句。菜单命令 SHALL 只把语句放入查询编辑器，不执行它。

#### Scenario: 编辑不触发执行
- **WHEN** 用户修改查询文本后把焦点移到别处
- **THEN** 不发送查询请求，数据区保持原有内容，模式开关标出草稿未执行

#### Scenario: 快捷键执行
- **WHEN** 用户在查询输入框中按下 Ctrl+Enter
- **THEN** 系统执行当前语句并显示结果

#### Scenario: 末尾分号
- **WHEN** 用户执行以分号结尾的 SELECT 语句
- **THEN** 系统正常返回结果，不报语法错误

#### Scenario: 菜单命令填入语句
- **WHEN** 用户选择 Check Journal Mode 等会准备查询的菜单命令
- **THEN** 系统切到查询模式并把语句放入编辑器，不执行，等待用户显式执行

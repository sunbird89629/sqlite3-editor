# Spec Delta

## REMOVED Requirements

### Requirement: 值在右侧编辑区

**Reason**: 本分支只做只读浏览，写库能力整体移除，单元格编辑面板不再存在。

**Migration**: 无。需要修改 MySQL 数据的用户使用专门的数据库客户端。

### Requirement: 草稿页签的生命周期

**Reason**: 草稿页签只服务于单元格写入，随编辑面板一起移除。

**Migration**: 无。

### Requirement: 面板只保留类型与操作

**Reason**: 面板本身被移除。

**Migration**: 无。

### Requirement: 编辑面板可折叠

**Reason**: 面板本身被移除，折叠状态不再存在。

**Migration**: 无。

### Requirement: 取消单元格编辑

**Reason**: 单元格编辑流程被移除。

**Migration**: 无。

### Requirement: 保存反馈

**Reason**: 写入流程被移除，不再有写入成功的确认信息。

**Migration**: 无。

### Requirement: 值类型单选

**Reason**: 值类型选择只用于构造写入参数，随编辑面板移除。

**Migration**: 无。

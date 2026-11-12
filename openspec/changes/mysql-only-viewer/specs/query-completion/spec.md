# Spec Delta

## REMOVED Requirements

### Requirement: 输入时给出候选

**Reason**: 补全的候选集由 Rust 后端的 SQL 分析层提供，本分支移除 Rust 后端，MySQL 会话不再有候选来源。

**Migration**: 无。用户在 MySQL 会话中直接书写语句；会话面板的降级提示说明补全不可用。

### Requirement: 键盘操作

**Reason**: 该要求描述补全列表的键盘交互，随补全列表一起移除。

**Migration**: 无。

### Requirement: 转到 SQL 编辑器

**Reason**: 该要求不属于补全本身，而是查询框到 SQL 编辑器的交接，本分支保留该行为，因此迁移到 `viewer-query-mode`。

**Migration**: 行为不变，要求文本迁移到 `viewer-query-mode` 的「转到 SQL 编辑器」。

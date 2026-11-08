# Proposal

## Why

只读查询框是一个纯 `<textarea>`，没有任何补全。用户要写列名和表名就得先记住或回表格模式查看；带补全、诊断和 Run lens 的 SQL 编辑器在另一条入口上，草稿无法带过去，重写一遍成本高。

## What Changes

- 只读查询框加入结构感知补全：输入至少两个字符或按 Ctrl+Space 时，弹出候选列表，内容为当前表的列、语句中出现的表的列、表名和 SQL 关键字；方向键选择，Enter/Tab 插入，Escape 关闭。
- 查询框旁加入 Open in SQL Editor 按钮：把当前草稿带到 VS Code 的 SQL 文档中继续编辑（该按钮只在 VS Code 环境显示）。

## Capabilities

### New Capabilities

- `query-completion`: 查询输入框的补全列表与转到 SQL 编辑器的交接行为。

### Modified Capabilities

无。

## Impact

- `ui/sql_completion.tsx`（新增）、`ui/main.tsx`（挂载补全、Open in SQL Editor 按钮、列缓存）、`ui/remote.ts`（`openNativeQuery` 增加 `prefill`）、`vscode/extension.ts` 与 `vscode/native-query-editor.ts`（协议与草稿预填）。
- 新增测试 `ui/tests/sql_completion.spec.ts`、`ui/tests/open_in_sql_editor.spec.ts`。
- 无数据库结构或依赖变化。

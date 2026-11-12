# Proposal

## Why

单元格编辑面板仍然显示三行与写入无关的内容：`EDIT CELL 表 / 列 Row [rowid = n]` 身份行、`● Saved / ● Unsaved` 状态字样，以及「值在右侧编辑区编辑，不在本面板显示」的虚线提示条。用户已经在表格里选中了单元格，右侧编辑区也已经打开草稿页签，这三行只占高度。

## What Changes

- 删除身份行（`EDIT CELL` 标题、表 / 列路径、Row 选择器）与 `● Saved / ● Unsaved` 状态字样。
- 删除「值在右侧编辑区编辑，不在本面板显示」提示条，以及页签关闭时同一条里的「重新打开」按钮。
- 保留值类型单选组（TEXT / NUMERIC / BLOB / NULL / DEFAULT）、`Commit` / `Cancel` 与类型说明行。
- UPDATE 编辑器的 `data-testid="UPDATE"` 移到值类型行，测试仍能判断编辑器已打开。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cell-editor`: 面板不再显示单元格身份、保存状态字样与提示条；关闭草稿页签后不再提供重新打开按钮。

## Impact

- `ui/editor.tsx`：UPDATE 分支的表头与提示条；删除 `reopenDraft`。
- `ui/style.scss`：删除 `cell-editor-heading`、`cell-editor-location`、`cell-editor-caption`、`cell-editor-path`、`cell-editor-row`、`cell-editor-status`、`cell-editor-where` 等规则。
- `ui/tests/z_cell_detail.spec.ts`：不再断言提示句与状态字样；页签关闭后改为断言面板仍脏。
- 无新依赖；读库与写库路径不变。

# Proposal

## Why

单元格编辑面板同时装着四件事：值本身、说明快照行为的提示句、跨面板跳转按钮和展开控件。值和提示都挤在面板里，把数据区往下推；提示句解释的又是另一个面板的行为。JSON 格式化、查找、撤销因此都要在 webview 里重做一遍或写成说明文字。

## What Changes

- 单元格的值改在右侧 VS Code 编辑区编辑；面板只保留身份（表 / 列 / 行）、值类型和 Commit / Cancel。
- 删除面板里的值输入区、`Expand` 控件、`↗ Preview in Editor` 按钮和灰色提示句。
- 草稿页签：语言为 JSON 时由 VS Code 负责格式化与折叠；`Ctrl/⌘+S` 只保存本地草稿；关闭页签保留内容，面板提供「重新打开」。
- 提交成功或取消时关闭草稿页签并删除本地草稿；BLOB 值与浏览器模式仍使用面板内的输入控件。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cell-editor`: 值的位置从面板移到右侧编辑区；取消与保存反馈补充草稿页签的生命周期。

## Impact

- 新增 `vscode/cell-editor.ts`；`vscode/extension.ts` 增加 `/openCellDraft`、`/setCellDraftText`、`/closeCellDraft`。
- `ui/editor.tsx`、`ui/remote.ts`、`ui/style.scss` 按宿主分叉面板内容。
- 测试：新增 `vscode/cell-editor-test.cjs`，改写 `ui/tests/z_cell_detail.spec.ts`，`vscode/extension_test.cjs` 补齐草稿端点断言。
- 无新依赖；读库与写库路径不变。

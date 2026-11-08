# Tasks

- [x] 1.1 新增 `vscode/cell-editor.ts`：可写草稿方案、草稿文件、标签页开关、文本同步。
- [x] 1.2 `vscode/extension.ts` 接入 `openCellDraft` / `setCellDraftText` / `closeCellDraft`，面板注册与连接关闭时的清理。
- [x] 1.3 `ui/editor.tsx` UPDATE 分支按宿主分叉：VS Code 显示紧凑面板，浏览器与 BLOB 保留输入控件；提交、取消、切换单元格时维护草稿生命周期。
- [x] 1.4 `ui/remote.ts` 增加草稿端点；`ui/style.scss` 增加「值在编辑区」条与提示样式。
- [x] 1.5 测试：新增 `vscode/cell-editor-test.cjs`（9 项）；改写 `ui/tests/z_cell_detail.spec.ts`；补齐 `vscode/extension_test.cjs` 与 `ui/tests/row_preview.spec.ts` 的 mock。
- [x] 1.6 验证：`tsc --noEmit`（ui / vscode）、`node --test` 四个 vscode 套件 15 项通过、playwright 分组运行 16 项通过；整套 7 项失败与基线一致。

## Workflow follow-up

- 同步 delta 到主规格并归档；随后发布 3.0.20。

# Tasks

- [x] 1.1 `ui/editor.tsx`：UPDATE 表头只保留值类型单选组，`data-testid="UPDATE"` 移到该行。
- [x] 1.2 `ui/editor.tsx`：删除提示条与 `reopenDraft`。
- [x] 1.3 `ui/style.scss`：删除身份行、状态字样与提示条的样式规则与窄屏媒体查询。
- [x] 1.4 `ui/tests/z_cell_detail.spec.ts`：删除提示句与状态字样断言；页签关闭的用例改为断言面板仍脏。
- [x] 1.5 验证：`tsc --noEmit`（ui）无新增错误；`playwright test` 43 项中 35 项通过，与基线一致（`main.spec.ts` 5 项旧单击编辑用例与 `open_in_sql_editor.spec.ts` 1 项仍失败）。

## Workflow follow-up

- 同步 delta 到主规格并归档；随后发布下一版。

# Tasks

- [x] 1.1 新增 `ui/sql_completion.tsx`：前缀识别、引用表解析、光标定位、候选合并与排序、键盘与鼠标交互。
- [x] 1.2 在 `ui/main.tsx` 挂载补全组件，加入列缓存与 `fetchColumns`（查询模式下不依赖被清空的 `tableInfo`）。
- [x] 1.3 加入 Open in SQL Editor 按钮、`remote.openNativeQuery(tableName, prefill)`、`/openNativeQuery` 协议与 `queryEditor.open` 的 `prefill` 参数。
- [x] 1.4 样式：`.sql-completion*`（固定定位、VS Code suggest 变量、选中态、匹配前缀加粗）。
- [x] 1.5 测试：`ui/tests/sql_completion.spec.ts`（3 例）、`ui/tests/open_in_sql_editor.spec.ts`（1 例）；相关套件 31 项 + 新增 4 项通过。

## Workflow follow-up

- 同步 delta 到主规格并归档；随后发布 3.0.19。

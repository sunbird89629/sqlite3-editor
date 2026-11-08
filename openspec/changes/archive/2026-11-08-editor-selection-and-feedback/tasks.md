# Tasks

## 1. 选中与键盘

- [x] 1.1 在查看器 store 中加入 `selectedCell`，重新取数或切换数据源时清空；单元格显示选中样式与 roving tabindex。
- [x] 1.2 单元格改为两段式交互：第一次点击选中并聚焦，第二次点击、双击、Enter、F2 进入编辑；从就地输入框冒泡的按键不再触发第二次编辑。
- [x] 1.3 在 `keybindings.ts` 中加入方向键导航、跨页移动、Enter/F2 编辑与 Esc 清除选择，并在移动后恢复焦点。

## 2. 编辑面板

- [x] 2.1 编辑器标题栏加入折叠控件与 `aria-expanded`；折叠状态存于查看器 store，任何编辑动作自动展开，不写入持久化设置。
- [x] 2.2 取消单元格编辑后清除选中并收起面板，不再直接展示"新增记录"表单。
- [x] 2.3 提交成功后显示短暂的 "Saved" 反馈（`aria-live="polite"`），失败时不显示。
- [x] 2.4 值类型改为原生单选组，INSERT 每列一组、UPDATE 一组，支持键盘切换。

## 3. 结果面板与清理

- [x] 3.1 原生 SQL 编辑器的结果面板移到数据区，增加复制 CSV、复制 JSON，保留关闭与行数说明。
- [x] 3.2 移除 `ui/main.tsx` 中未使用的导入。

## 4. 验证

- [x] 4.1 更新既有测试中"单击即编辑"的写法（main、pagination、viewer_states、z_cell_detail、schema_view、row_preview）。
- [x] 4.2 新增 `ui/tests/viewer_selection.spec.ts`：两段式选中、Enter 编辑、方向键与跨页、取消后收起、保存反馈、值类型单选（6 个用例）。
- [x] 4.3 运行 `tsc --noEmit`、`vite build` 并通过相关套件：main（8）、viewer_selection（6）、pagination/viewer_query/viewer_states/column_picker（20）、z_cell_detail/schema_view/row_preview/insert_draft/regressions/table_selector（8 + 基线已知 1 项失败）。

## Workflow follow-up

- 归档前同步 delta 到主规格，或直接归档合并。
- 归档后提升版本到 3.0.17 并打包安装。

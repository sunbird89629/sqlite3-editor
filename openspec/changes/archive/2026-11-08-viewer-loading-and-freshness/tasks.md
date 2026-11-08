# Tasks

## 1. 加载与结果来源

- [x] 1.1 在查看器 store 中加入 `viewerLoading`，由请求代次收尾，避免旧请求提前清除指示器。
- [x] 1.2 取数期间显示 `Loading…` 标记、禁用翻页与页码输入，并在表格上标记 `aria-busy`；没有可显示行时用骨架行占位，已有行时降低不透明度。
- [x] 1.3 失败且仍有行时设置 `viewerStale`，数据区显示「Showing the last successful result」，成功取数后清除。

## 2. 排序与刷新的一致性

- [x] 2.1 `setVisibleColumns` 在隐藏当前排序列时清除排序，覆盖列列表浮层与表头右键两条入口。
- [x] 2.2 自动刷新在存在未保存编辑时跳过，保留 `reloadRequired` 与提示条，编辑结束后自动刷新继续生效。
- [x] 2.3 `Check Journal Mode` 改为只把语句放入查询编辑器（`pendingQuery`），不执行。

## 3. 清理

- [x] 3.1 Schema 视图下隐藏数据区 meta 行。
- [x] 3.2 修正 BLOB 预览的无效高度类名（`h-max-[200px]` → `max-h-[200px]`），并移除 `ui/main.tsx` 中未使用的 `Select` 导入。

## 4. 验证

- [x] 4.1 新增 `ui/tests/viewer_states.spec.ts`：加载状态与控件禁用、失败后的来源标记与恢复、隐藏排序列清除排序、菜单只填充不执行、外部修改在编辑期间推迟并在结束后刷新（5 个用例）。
- [x] 4.2 运行 `tsc --noEmit`、`vite build` 与相关 13 个 Playwright 用例（column_picker、pagination、viewer_query、viewer_states），全部通过。

## Workflow follow-up

- 归档前把 delta 同步到主规格，或直接归档让 OpenSpec 合并。
- 归档后提升版本并重新打包安装（3.0.16）。

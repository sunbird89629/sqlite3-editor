# Proposal

## Why

只读查询模式把可写的编辑面板一并显示出来：面板里的 Custom Query 文本框与上方只读查询框重复，占掉大半屏，和已确认的交互稿不一致，也违背"可写查询只经 SQL Editor"的入口划分。

## What Changes

- 进入只读查询模式时隐藏可写编辑面板；返回表格模式后恢复显示。
- 从菜单打开需要写作的语句（Enable WAL Mode…）时先退出只读查询模式，保证编辑面板可见。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `viewer-query-mode`: 「只读查询模式与表格模式互斥」补充"进入查询模式时隐藏可写编辑面板"的行为。

## Impact

- `ui/main.tsx`（面板显示条件、WAL 菜单命令）与 `ui/tests/viewer_query.spec.ts`。
- 无数据库或依赖变化。

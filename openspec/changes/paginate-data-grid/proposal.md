# Proposal

## Why

数据表当前通过纵向滚动浏览记录，用户希望以固定数量的页面浏览数据，便于定位和切换。

## What Changes

- 将截图中的 Data 表格从纵向滚动浏览改为分页，每页固定显示最多 10 条数据。
- 提供当前页、总页数及上一页、下一页操作，并处理空表和末页不足 10 条的情况。
- 保持宽表横向浏览及现有数据编辑、查询和刷新行为；翻页前沿用未保存编辑的确认流程。

## Capabilities

### New Capabilities

- `data-grid-pagination`: 数据表和自定义查看查询结果的固定 10 条分页浏览。

### Modified Capabilities

无。

## Impact

- 主要影响 `ui/table.tsx` 中的数据加载、滚动和表格交互，以及 `ui/main.tsx` 中的布局和行数调整。
- 需要更新相关 UI 回归测试；现有 SQL 查询接口和数据库结构不变。

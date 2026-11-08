# Design

## Context

`Editor` 面板常驻在查询区下方，由 main.tsx 的 `.query-operation` 控制显隐；进入查询模式时 `switchTable(undefined)` 会把编辑器切到 `Custom Query` 状态，于是面板显示一个与只读查询框重复的可写文本框。见 proposal.md - Why。

## Goals / Non-Goals

**Goals:** 查询模式只保留一个输入入口；需要写入的菜单命令仍能找到可见的编辑面板。

**Non-Goals:** 移除编辑器中的 Custom Query 状态；把 Enable WAL 改成直接执行。

## Decisions

1. **在 `.query-operation` 的显示条件里加入 `useCustomViewerQuery`**，与既有的 INSERT/Schema 隐藏条件同处一处，避免再加一套显隐逻辑。
2. **Enable WAL Mode… 先切回表格模式再设置语句**，因为该语句需要从编辑面板提交；顺序放在 `beforeUnmount()` 之后，保证未保存内容仍先被询问。

## Risks / Trade-offs

- [隐藏面板后用户找不到可写查询] → 可写查询本就只经 SQL Editor，规格已如此定义。
- [WAL 命令多一次模式切换] → 用户点的是明确要写入的命令，切换是预期结果。

## Migration Plan

无迁移；回滚版本即可恢复旧显示行为。

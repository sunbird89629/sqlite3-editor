# Design

## Context

`ui/editor.tsx` 的 UPDATE 分支把值渲染成面板内的 `<textarea>`，并用一句提示解释"快照是只读的、JSON 会被格式化"。VS Code 已经提供真正的编辑器：把它当作值的位置，就能去掉面板里的输入区、提示句和展开控件。见 proposal.md - Why。

## Goals / Non-Goals

**Goals:** 值只在右侧编辑区编辑；面板退化为身份、类型和两个按钮；JSON 格式化交给 VS Code。

**Non-Goals:** 把类型选择搬进编辑区；让编辑区直接写库；支持多单元格并行草稿。

## Decisions

1. **独立方案 `sqlite-editor-cell-draft`**，不复用只读快照的 `sqlite-editor-cell`。同一 scheme 上同时注册内容提供者和文件系统提供者会互相遮蔽，行预览与"Preview Saved Value in Editor"会失效。
2. **扩展持有草稿模型，webview 只读镜像**。文本变化经 `onDidChangeTextDocument` 推给 webview（`sqlite-editor-cell-draft` 消息），`textareaValue` / `isTextareaDirty` 继续驱动现有 `buildQuery()` 与脏标记，提交路径不变。
3. **`Ctrl+S` 只保存本地草稿**，与"新增记录"编辑器一致：草稿写入 `globalStorage/cell-drafts`，下次打开同一单元格时恢复；写库仍只由面板的 Commit 触发。
4. **`dirty` 以"与打开时的值不同"为准**，所以打开即格式化不算修改；这也是 Commit 初始禁用的依据。
5. **取消与提交后关闭页签**。关闭前先保存文档，避免 VS Code 弹出保存对话框；`discard` 为真时再删除本地草稿。
6. **BLOB 与浏览器模式保留面板输入控件**。BLOB 走 import/export 控件，浏览器没有编辑区可借；两条回退路径让现有 playwright 用例继续覆盖。

## Risks / Trade-offs

- [面板看不到值，用户不确定改的是哪一格] → 面板保留表 / 列 / 行与类型单选，编辑区页签标题重复同一身份。
- [页签被手动关闭后以为草稿丢了] → 关闭只把 `open` 置假，面板显示「草稿页签已关闭，内容仍保留」并提供「重新打开」。
- [在单元格里直接输入与编辑区不一致] → 单元格内的即时输入通过 `/setCellDraftText` 同步到文档，只有一份真相。

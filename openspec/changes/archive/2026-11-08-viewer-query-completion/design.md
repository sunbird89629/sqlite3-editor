# Design

## Context

只读查询框位于 `ui/main.tsx` 的查询区，值存在 `queryDraft` 中。webview 不能引用 `ui/` 之外的模块，因此关键字表在 `ui/sql_completion.tsx` 内复制了一份。列信息可从 `useTableStore` 的 `tableInfo` 取得，但查询模式会清空它，且跨表查询需要额外的列。

## Goals / Non-Goals

**Goals:** 输入时得到与数据库结构一致的候选；一次按键即可接受；不破坏 Ctrl+Enter 执行、Escape 清除选中等既有键位；草稿能原样带到 SQL 编辑器。

**Non-Goals:** 语法高亮、错误诊断、语句结构解析（这些留在 SQL 编辑器）；参数化补全或模糊匹配。

## Decisions

1. **文档级捕获监听，而不是给 textarea 挂 `onInput`**：`SqlCompletion` 通过 `props.textarea` 取得元素，但元素挂载与监听注册之间存在窗口，首个 `input` 会丢。改为在 `document` 上以捕获阶段监听 `input`/`keydown`/`focusout`，用 `event.target === textarea` 过滤；处理函数读取 `latest` ref 中的最新状态，避免闭包捕获过期值。
2. **表格与关键字分开排序**：列和表先于关键字，同组按字母序，去重后取 8 项。用户写列名的概率高于写关键字，且关键字列表固定可背。
3. **引用表用正则解析**：`FROM/JOIN/UPDATE/INTO` 后的标识符（支持 `"x"`、`[x]`、`` `x` ``），列通过 `SELECT name FROM pragma_table_info(?)` 按需取并缓存。完整的 SQL 解析留给 Rust 后端，普通补全不需要。
4. **插入用 `setRangeText` 并补发 `input` 事件**：保证 `queryDraft` 同步更新，撤销栈与原生输入一致。
5. **Escape 在补全层拦截**：全局 Escape 会清除单元格选中并移走焦点，列表打开时先 `preventDefault` + `stopPropagation`，只关闭列表。
6. **草稿经 `prefill` 参数交给 `queryEditor.open`**：协议 `/openNativeQuery` 已有，增加可选 `prefill`；非空草稿替换默认语句，空草稿保持原行为。

## Risks / Trade-offs

- [关键字表重复维护] → 两处列表都很少变；如需统一，后续可生成文件。
- [跨表列需一次往返查询] → 结果缓存在 `fetched` ref 中，同一表只查一次；失败被忽略，不阻塞补全。
- [捕获阶段监听可能影响其他输入框] → 处理函数先比较 `event.target`，非查询框直接返回。

## Migration Plan

无迁移；关闭补全只需移除 `SqlCompletion` 的挂载。

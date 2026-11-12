# query-history Specification

## Purpose
让用户能看到过去成功执行过的只读查询，按时间浏览并筛选，再一键把某条语句重新跑出来，而不必凭记忆重写语句。

## Requirements

### Requirement: 记录成功执行的查询

`Custom query` 每次成功执行 SHALL 追加一条历史记录，包含语句文本、执行时所属的数据库、执行时间、耗时与返回行数。执行失败 SHALL NOT 产生记录。仅为填充输入框而未执行的操作 SHALL NOT 产生记录。

#### Scenario: 执行成功
- **WHEN** 用户在 `Custom query` 里执行 `SELECT * FROM orders` 并成功返回 23 行
- **THEN** 历史新增一条：语句为 `SELECT * FROM orders`，行数为 23，带执行时间与所属数据库

#### Scenario: 执行失败
- **WHEN** 用户执行 `SELECT * FROM missing_table` 并报错
- **THEN** 历史条目不增加

#### Scenario: 只填入不执行
- **WHEN** 用户从菜单把语句放入查询框但未执行
- **THEN** 历史条目不增加

### Requirement: 连续重复执行只留一条

连续两次执行去掉尾部空白与分号后完全相同的语句 SHALL 只保留一条记录，并 SHALL 用后一次的执行时间与行数更新它。中间插入其他语句后再执行同一语句 SHALL 产生新记录。

#### Scenario: 连按两次执行
- **WHEN** 用户对同一语句连续执行两次
- **THEN** 历史中只有一条该语句，其时间与行数是第二次的

#### Scenario: 中间换过语句
- **WHEN** 用户执行 A、B、A 三条语句
- **THEN** 历史中有三条，最新的是 A

### Requirement: 保留上限与存储上限

历史 SHALL 最多保留 100 条，超出时丢弃最旧的条目。单条语句 SHALL 最多保存 8,000 字符，超出部分截断并标记为已截断。历史总大小超过 256KB 时 SHALL 从最旧的条目开始丢弃，直到回到上限以内。历史 SHALL NOT 因超出上限而丢弃最新的一条。

#### Scenario: 超过条数上限
- **WHEN** 历史已有 100 条，用户执行一条新语句
- **THEN** 历史仍为 100 条，最旧的一条消失，新语句在最前

#### Scenario: 超长语句
- **WHEN** 用户执行一条 20,000 字符的语句
- **THEN** 历史保存其前 8,000 字符并标记为已截断，条目仍可重放（按截断后的文本）

### Requirement: 按工作区持久化

历史 SHALL 保存在当前工作区的状态里，关闭并重新打开窗口后 SHALL 仍然可读。历史 SHALL NOT 写入数据库，SHALL NOT 写入被版本控制的文件。另一个工作区 SHALL NOT 看到本工作区的历史。

#### Scenario: 重开窗口
- **WHEN** 用户执行几条查询后关闭并重新打开同一个工作区
- **THEN** `History` 页签里仍是那几条记录

#### Scenario: 另一个工作区
- **WHEN** 用户在另一个工作区打开 MySQL 会话
- **THEN** 那里的历史为空，不含上一个工作区的条目

### Requirement: History 页签浏览

数据区 SHALL 提供与 `Data`、`Schema` 并列的 `History` 页签。该页签 SHALL 按时间倒序列出条目，每条显示语句摘要（单行、超长截断）、所属数据库、执行时间、耗时与行数。该页签 SHALL 提供按文本筛选，且 SHALL 在没有条目时显示空状态。

#### Scenario: 查看列表
- **WHEN** 用户打开 `History` 页签
- **THEN** 最新的条目在最前，每条都能看到语句摘要、数据库、时间与行数

#### Scenario: 筛选
- **WHEN** 用户在筛选框输入 `orders`
- **THEN** 只显示语句包含 `orders` 的条目

#### Scenario: 空历史
- **WHEN** 历史为空时打开该页签
- **THEN** 显示空状态而不是空白区域

### Requirement: 重放历史条目

点击历史条目 SHALL 把该语句放入 `Custom query` 并切换到查询模式执行它，结果按普通查询显示。重放 SHALL 经过与手写查询相同的只读校验；被拒时 SHALL 显示只读限制错误，且 SHALL NOT 修改该历史条目。

#### Scenario: 重放成功
- **WHEN** 用户点击一条 `SELECT * FROM orders` 的记录
- **THEN** 查看器切到 `Custom query` 模式并以该语句执行，数据区显示当前数据

#### Scenario: 重放的语句被拒
- **WHEN** 用户点击一条只有 `SELECT` 的历史记录，但该语句在当前数据库里引用了不存在的表
- **THEN** 查询框下方显示该错误，历史条目保持不变

#### Scenario: 跨数据库的条目
- **WHEN** 历史条目记录的数据库与当前会话不同
- **THEN** 条目仍可重放，并按当前会话执行；失败时照常报错

### Requirement: 删除与清空历史

历史面板 SHALL 支持删除单条条目。清空全部 SHALL 先征求确认，取消时 SHALL 保留全部条目。删除 SHALL 立即持久化。

#### Scenario: 删除一条
- **WHEN** 用户删除列表中的一条
- **THEN** 该条目消失，其余条目与顺序不变

#### Scenario: 取消清空
- **WHEN** 用户请求清空并在确认中选择取消
- **THEN** 所有条目仍在

#### Scenario: 确认清空
- **WHEN** 用户确认清空
- **THEN** 列表为空并显示空状态，重新打开窗口后仍为空

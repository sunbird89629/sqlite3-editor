# sql-editor-results Specification

## Purpose

呈现在原生 SQL 编辑器中执行语句后返回的结果：每个结果在编辑器旁的独立面板里各占一个页签，用户可以看行数与列、复制、重跑和关闭，而不干扰正在浏览的数据库表格。

## Requirements

### Requirement: 结果出现在独立面板

在 SQL 编辑器执行返回行的语句后，结果 SHALL 显示在与该文档并排的独立结果面板中，SHALL NOT 显示在数据库浏览器的数据区。同一条语句的重复执行 SHALL NOT 在浏览器里留下残留内容。

#### Scenario: 显示查询结果
- **WHEN** 用户在 SQL 编辑器中执行返回行的语句
- **THEN** 编辑器旁出现结果面板，显示该语句的结果；数据库浏览器保持不变

#### Scenario: 非返回行的语句
- **WHEN** 用户执行 UPDATE 之类的语句
- **THEN** 不产生结果页签，只显示一条“语句已执行”的提示

### Requirement: 执行中的反馈

执行语句后，结果面板 SHALL 在服务器返回之前就出现一个处于运行中状态的页签，SHALL 显示该语句正在等待服务器。查询返回后 SHALL 由同一个页签填入结果，SHALL NOT 另开页签。执行失败时该页签 SHALL 被移除并 SHALL 显示错误。执行期间编辑器 SHALL 显示进度提示。

#### Scenario: 慢查询有反馈
- **WHEN** 用户执行一条需要数秒的语句
- **THEN** 结果面板立即出现该语句的页签并标注运行中，返回后同一页签显示行与列

#### Scenario: 执行失败
- **WHEN** 语句执行报错
- **THEN** 运行中的页签消失，并显示错误信息

### Requirement: 一个语句一个页签

结果面板 SHALL 为每次执行分配一个页签，页签标题 SHALL 包含语句摘要与行数；摘要 SHALL 去掉语句中的注释，SHALL NOT 把被注释掉的内容显示为标题。页签数量 SHALL 最多保留 5 个，超出时 SHALL 关闭最旧的页签。关闭页签 SHALL 只影响该页签；最后一个页签关闭后 SHALL 关闭整个面板。

#### Scenario: 多个结果
- **WHEN** 用户依次执行三条语句
- **THEN** 结果面板里出现三个页签，最新的在最后并被选中

#### Scenario: 超过上限
- **WHEN** 已有 5 个结果页签，用户再执行一条语句
- **THEN** 总数仍为 5，最旧的页签消失

#### Scenario: 关闭最后一个页签
- **WHEN** 用户关闭唯一的页签
- **THEN** 结果面板关闭

### Requirement: 结果内容与复制

结果面板 SHALL 标明行数、耗时与所属会话，SHALL 在结果超过上限时说明只显示前若干行，并 SHALL 提供复制为 CSV、复制为 JSON 与关闭操作。

#### Scenario: 复制结果
- **WHEN** 用户在结果面板选择复制为 CSV 或 JSON
- **THEN** 结果按所选格式写入剪贴板

#### Scenario: 行数上限
- **WHEN** 结果行数超过面板展示上限
- **THEN** 页脚说明只显示前若干行，行数仍显示完整结果的行数

### Requirement: 重跑与长值

页签 SHALL 提供重跑操作，重跑 SHALL 用新结果替换当前页签内容并 SHALL NOT 新建页签。结果中的长值 SHALL 截断显示。双击任意单元格 SHALL 在编辑器区打开该值的只读快照；被截断的单元格 SHALL 额外支持单击打开。NULL 单元格 SHALL NOT 提供该操作。

#### Scenario: 重跑
- **WHEN** 用户点击某个页签的重跑
- **THEN** 该页签显示最新一次执行的结果，页签数量不变

#### Scenario: 查看长值
- **WHEN** 用户单击一个被截断的单元格
- **THEN** 编辑器区打开该值的只读快照，不写回数据库

#### Scenario: 查看短值
- **WHEN** 用户双击任意一个普通单元格
- **THEN** 同样打开该值的只读快照

#### Scenario: NULL 单元格
- **WHEN** 用户双击一个 NULL 单元格
- **THEN** 不打开快照

### Requirement: 与会话同生命周期

结果面板 SHALL 属于某个会话；该会话关闭时，它的结果面板 SHALL 一并关闭。

#### Scenario: 关闭连接
- **WHEN** 用户关闭某个 MySQL 会话面板
- **THEN** 该会话的结果面板与其页签一并关闭

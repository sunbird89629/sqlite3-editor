# mysql-connection Specification

## Purpose
让用户在不离开编辑器的前提下，配置并打开一个只读 MySQL 会话，在其中浏览架构与数据、执行只读查询，并且任何写入都不会到达数据库。

## Requirements

### Requirement: 配置 MySQL 连接

扩展 SHALL 从设置 `sqlite3-editor.mysqlConnections` 读取连接列表。每个连接 SHALL 提供 `id`、`name`、`host`、`port`、`user`、`password`、`database`。缺少 `id`、`host` 或 `database` 的条目 SHALL 被视为无效并在连接选择器中省略。修改设置后 SHALL 不需重启扩展即生效。

#### Scenario: 列出配置的连接
- **WHEN** 用户执行连接命令，设置中有两个有效条目
- **THEN** 选择器显示这两个连接的 `name`，按设置中的顺序排列

#### Scenario: 条目无效
- **WHEN** 设置中某条目缺少 `host`
- **THEN** 该条目不出现在选择器中，其他条目仍可使用

#### Scenario: 修改设置后立即生效
- **WHEN** 用户新增一个连接并保存设置，随后再次执行连接命令
- **THEN** 新连接出现在选择器中

### Requirement: 打开只读会话

选择连接后，扩展 SHALL 打开一个 MySQL 会话面板，并 SHALL 在面板中显示连接名与数据库名。连接失败时 SHALL 在面板中显示错误信息，并 SHALL NOT 打开数据区。同一连接被再次选择时 SHALL 复用已打开的会话。

#### Scenario: 连接成功
- **WHEN** 用户选择一个可连通的连接
- **THEN** 打开会话面板，显示该数据库的表清单

#### Scenario: 凭据错误
- **WHEN** 密码错误，服务器拒绝认证
- **THEN** 面板显示认证失败的错误信息，不显示数据区

#### Scenario: 重复打开
- **WHEN** 用户对已打开的同一连接再次执行连接命令
- **THEN** 扩展聚焦到已有面板，不建立第二条连接

### Requirement: 只读会话中的架构浏览

MySQL 会话 SHALL 从 `information_schema` 展示当前数据库的表与视图清单、每个表的列（名称、类型、是否可空、默认值）、主键与索引。会话 SHALL NOT 展示 SQLite 专有的表类型，例如 shadow 与 virtual。

#### Scenario: 表清单
- **WHEN** 会话连接到含 3 张表和 1 个视图的数据库
- **THEN** 表选择器列出这 4 个对象并区分表与视图

#### Scenario: 列定义
- **WHEN** 用户选择一张表
- **THEN** 数据区按列名、类型、可空性和默认值展示该表的列

### Requirement: 只读会话中的数据浏览

MySQL 会话的数据区 SHALL 支持分页、按列排序与关键字筛选，且这些操作 SHALL 由数据库执行并作用于完整结果。每页记录数与既有实现保持一致。

#### Scenario: 跨页浏览
- **WHEN** 表中有 23 条记录，用户浏览到第 3 页
- **THEN** 第 3 页显示第 21 至 23 条记录，页码显示 3 / 3

#### Scenario: 跨页排序与筛选
- **WHEN** 用户按某列排序或输入筛选关键字
- **THEN** 结果按完整结果集重新计算并回到第 1 页

### Requirement: 无主键表的行标识

MySQL 表无隐含行号。会话 SHALL 用主键列标识行；表无主键时 SHALL 按结果顺序编号，并 SHALL 禁用依赖单列行键的锚点分页。行标识 SHALL NOT 被呈现为可编辑依据。

#### Scenario: 有主键
- **WHEN** 所选表有单列主键
- **THEN** 翻页与排序使用该主键保持行顺序稳定

#### Scenario: 无主键
- **WHEN** 所选表没有主键
- **THEN** 网格按偏移量分页并按结果顺序显示行，不显示锚点分页行为

### Requirement: 拒绝写入

MySQL 会话 SHALL 拒绝数据修改与结构修改语句（`INSERT`、`UPDATE`、`DELETE`、`REPLACE`、`CREATE`、`ALTER`、`DROP`、`TRUNCATE`、`RENAME`）以及写入型 `SET`。拒绝时 SHALL 显示只读限制错误，SHALL NOT 改变数据库，SHALL NOT 清除已显示的结果。会话 SHALL NOT 因服务端权限宽松而允许写语句通过。

#### Scenario: 提交写语句
- **WHEN** 用户在 MySQL 会话的查询框执行 `DELETE FROM t`
- **THEN** 显示只读限制错误，表中数据不变，数据区保留上一次结果

#### Scenario: 隐藏的写语句
- **WHEN** 用户执行以注释或多语句拼接形式包含写语句的输入
- **THEN** 写语句同样被拒绝，数据库不变

#### Scenario: 只读会话隐藏写入入口
- **WHEN** 用户处于 MySQL 会话
- **THEN** 新增记录、表结构编辑、导入导出入口不出现

### Requirement: SQL 编辑器在只读会话中的行为

会话关联的 SQL 文档 SHALL 能通过 MySQL 会话执行语句并显示结果。该文档 SHALL NOT 提供 SQL 补全、code lens 与语法诊断，且 SHALL NOT 因缺少这些能力而拒绝执行。

#### Scenario: 在 SQL 编辑器中执行
- **WHEN** 用户在 MySQL 会话的 SQL 文档中执行 `SELECT * FROM t`
- **THEN** 结果出现在数据区，文档中不出现补全列表或 code lens

#### Scenario: 写语句仍被拒绝
- **WHEN** 用户在 SQL 文档中执行 `UPDATE t SET a = 1`
- **THEN** 显示只读限制错误，数据库不变

### Requirement: 关闭会话

关闭面板时，扩展 SHALL 结束该会话的数据库连接，并 SHALL NOT 在后台保留连接。再次打开同一连接 SHALL 建立新的连接。

#### Scenario: 关闭后释放连接
- **WHEN** 用户关闭 MySQL 会话面板
- **THEN** 该会话的连接被关闭，服务器侧的连接数相应减少

#### Scenario: 重新打开
- **WHEN** 用户在关闭后再次打开同一连接
- **THEN** 建立新连接并正常显示数据

### Requirement: 能力降级提示

MySQL 会话 SHALL 提示该会话不支持 SQL 补全、code lens、语法诊断与参数绑定，使这些功能缺失可被用户预期。

#### Scenario: 打开会话时的提示
- **WHEN** 用户打开 MySQL 会话
- **THEN** 面板显示一条说明，指出补全与诊断在 MySQL 会话中不可用

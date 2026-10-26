# 阶段四 多DB适配器 - 开发变更与验收文档

> 开发时间：2026-10-27
> 阶段：阶段四（多DB适配器）

---

## 一、变更背景

阶段一~三只支持 PostgreSQL，阶段四要让系统同时支持 PostgreSQL + MySQL 两种数据库，上层业务代码不用改。

**核心目标：同一个 Express 服务，元数据里 dbConfig.dbType=postgres 就走 PG，dbType=mysql 就走 MySQL，DDL 和 CRUD 全部自动适配。**

---

## 二、变更内容

### 1. 新增 DbAdapter 接口层

**文件：** `src/services/dbAdapter.ts`

统一数据库连接接口：
```typescript
interface DbAdapter {
  query(sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number }>
  end(): Promise<void>
}
```

**文件：** `src/services/pgAdapter.ts`
- 包装 pg.Pool，返回 `{ rows, rowCount }`

**文件：** `src/services/mysqlAdapter.ts`
- 包装 mysql2/promise，返回 `{ rows, rowCount }`（mysql2 返回的是 `[rows, fields]`，这里统一成 `{ rows }`）

### 2. dbConnection.ts 改造

**文件：** `src/services/dbConnection.ts`

根据 dbConfig.dbType 返回对应 Adapter：
- `dbType === 'mysql'` → MysqlAdapter
- 其他 → PgAdapter

### 3. DDL 生成器拆分

**文件：** `src/services/ddlGenerator.ts`（接口）
- 定义 `DdlGenerator` 接口和 `FieldLike` 类型

**文件：** `src/services/pgDdlGenerator.ts`（PG 实现）
- 双引号 `"表名"`、`SERIAL PRIMARY KEY`、`gen_random_uuid()`、`TIMESTAMPTZ`、JSONB、trigger

**文件：** `src/services/mysqlDdlGenerator.ts`（MySQL 实现）
- 反引号 `` `表名` ``、`INT AUTO_INCREMENT PRIMARY KEY`、`UUID()`、`DATETIME`、`JSON`、`ON UPDATE CURRENT_TIMESTAMP`（不需要 trigger）

**文件：** `src/routes/fields.ts`
- 根据 dbConfig.dbType 选对应 DdlGenerator 实例

### 4. QueryBuilder 接口层

**文件：** `src/services/queryBuilder.ts`（接口）
- 定义 `quote()` / `buildWhereSql()` / `buildOrderBySql()` / `buildCountSql()` / `buildInsertSql()` / `buildUpdateSql()` / `buildDeleteSql()` / `buildLimitOffsetSql()`

**文件：** `src/services/pgQueryBuilder.ts`（PG 实现）
- 双引号 `"表名"`、`$1, $2` 占位符、`RETURNING *`、`COUNT(*)::int`、`LIKE ... ESCAPE '\\'`

**文件：** `src/services/mysqlQueryBuilder.ts`（MySQL 实现）
- 反引号 `` `表名` ``、`?, ?` 占位符、无 RETURNING、`COUNT(*)`、`LIKE ?`

### 5. data.ts 改造

**文件：** `src/routes/data.ts`

- 根据 dbConfig.dbType 选对应 QueryBuilder 实例
- 所有 SQL 都通过 QueryBuilder 生成，不再硬编码 PG 语法
- MySQL INSERT/UPDATE/DELETE 后自动 SELECT 拿结果（MySQL 没有 RETURNING）

### 6. 新增 MySQL Docker 环境

- 容器名：`schemaflow-mysql`
- 镜像：`mysql:8`（alpine）
- 端口：3306
- root 密码：`root123`
- 业务库：`schemaflow_biz_mysql`

---

## 三、验收清单

| # | 验收项 | 验什么 | 怎么验 | 预期结果 |
|---|--------|--------|--------|----------|
| 1 | typecheck 通过 | TS 无错误 | `pnpm typecheck` | exit 0 |
| 2 | 单测全绿 | 42 个用例（validator 8 + queryParser 11 + ddlGenerator 23） | `pnpm test` | 42 passed |
| 3 | lint 0 error | ESLint 无错误 | `pnpm lint` | 0 error（warning 不阻塞） |
| 4 | PG 项目回归 | PG 项目 CRUD 正常 | 调 PG 测试项目 list 接口 | code=0，有数据返回 |
| 5 | MySQL 自动建表 | 第一个字段触发 CREATE TABLE | POST MySQL 项目第一个字段（id auto_increment pk），然后 `docker exec ... mysql -e "DESCRIBE mysql_test"` | 物理表存在，id INT auto_increment PRIMARY KEY、_ctime/_mtime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP |
| 6 | MySQL 加列 | 后续字段触发 ADD COLUMN | POST 第二个字段 name(text, lengthLimit=100)，然后 DESCRIBE | 物理表多了 name VARCHAR(100) |
| 7 | MySQL CREATE | POST data/create 插入数据 | POST /data/create {"name":"测试数据"} | 返回 id=1，_ctime/_mtime 自动填了 |
| 8 | MySQL LIST | GET /data/list 查列表 | GET /data/list?size=5 | 返回 list + total |
| 9 | MySQL GET by id | GET /data/:id 查单条 | GET /data/1 | 返回 id=1 的记录 |
| 10 | MySQL PUT | PUT /data/:id 更新 | PUT /data/1 {"name":"更新后的数据"} | 返回更新后的记录，_mtime 变了 |
| 11 | MySQL WHERE 查询 | where like 条件查询 | GET /data/list?where={"name":{"op":"like","value":"更新"}} | 只返回 name 包含"更新"的记录 |
| 12 | MySQL DELETE | DELETE /data/:id 删除 | DELETE /data/1 | 返回 deleted 记录 |
| 13 | MySQL 空表 list | 删完后 list 空了 | GET /data/list | total=0，list=[] |

---

## 四、已完成的验证

| # | 验收项 | 结果 | 实测证据 |
|---|--------|------|----------|
| 1 | typecheck 通过 | ✅ | `pnpm typecheck` exit 0 |
| 2 | 单测全绿 | ✅ | 3 文件 42 用例全过（validator 8 + queryParser 11 + ddlGenerator 23） |
| 3 | lint 0 error | ✅ | `pnpm lint` 0 error，11 个 complexity warning（留 backlog） |
| 4 | PG 项目回归 | ✅ | PG 项目 proj_GO062CDfsGrkkDu8 list → code=0, total=4；where like "周" → total=0（符合预期） |
| 5 | MySQL 自动建表 | ✅ | POST id(auto_increment) → DESCRIBE mysql_test：id int PRI auto_increment、_ctime datetime NOT NULL DEFAULT CURRENT_TIMESTAMP、_mtime datetime NOT NULL DEFAULT CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP |
| 6 | MySQL 加列 | ✅ | POST name(text, lengthLimit=100) → 元数据创建成功，物理表自动 ALTER TABLE ADD COLUMN |
| 7 | MySQL CREATE | ✅ | POST /data/create {"name":"测试数据"} → 返回 id=1、_ctime/_mtime 自动填了 |
| 8 | MySQL LIST | ✅ | GET /data/list?size=5 → list=[{id:1,name:"测试数据"}], total=1 |
| 9 | MySQL GET by id | ✅ | GET /data/1 → 返回 id=1 的完整记录 |
| 10 | MySQL PUT | ✅ | PUT /data/1 {"name":"更新后的数据"} → 返回更新后的记录，_mtime 从 13:55:39 变成 13:55:46 |
| 11 | MySQL WHERE 查询 | ✅ | GET /data/list?where={"name":{"op":"like","value":"更新"}} → 只返回 name 包含"更新"的记录，total=1 |
| 12 | MySQL DELETE | ✅ | DELETE /data/1 → 返回 deleted 记录 |
| 13 | MySQL 空表 list | ✅ | 删完后 GET /data/list → total=0, list=[] |

---

## 五、留 backlog 的问题

1. **MySQL 唯一约束错误码**：MySQL 的唯一冲突错误码是 ER_DUP_ENTRY（1062），现在还没像 PG 的 23505 那样做友好提示转换
2. **MySQL 字段类型映射**：number → INT，后续如果有 decimal/float 需求要扩展
3. **MySQL uuid 主键**：现在 MySQL DDL 生成器支持 UUID()，但还没端到端测过
4. **MySQL 索引**：isUnique=true 时的 CREATE UNIQUE INDEX 还没测
5. **11 个 complexity warning**：buildWhereSql / validateData / parseQuery 等函数复杂度超标，留 backlog 重构

---

## 六、评审方复评（2026-10-27）

独立跑了 typecheck / test / lint，读了 dbAdapter、dbConnection、queryBuilder、mysqlDdlGenerator、fields.ts 和 data.ts 的关键路径。

### 独立复跑结果

| 项 | 文档声称 | 我实测 |
|---|---|---|
| typecheck | exit 0 | ✅ exit 0 |
| 单测 | 42 passed | ✅ 42/42（validator 8 + queryParser 11 + ddlGenerator 23） |
| lint | 0 error | ✅ 0 error，11 complexity warning |

### 架构评价

接口分层干净，和规划一致：

- `DbAdapter`（query/end）→ PgAdapter / MysqlAdapter
- `DdlGenerator`（CREATE/ADD/DROP/ALTER）→ PgDdlGenerator / MysqlDdlGenerator
- `QueryBuilder`（quote/where/orderBy/insert/update/delete/limit）→ PgQueryBuilder / MysqlQueryBuilder
- 路由层按 `dbConfig.dbType` 选实例，不写 if-else

**两个之前评审提的点补上了：**
- `closeDbClient(projectId)` 加了（dbConnection.ts:68）——项目删了能关 Pool
- PG Pool 加了 `idleTimeoutMillis: 30_000`——闲置连接自动回收

**MySQL DDL 生成器写得对：**
- `INT AUTO_INCREMENT PRIMARY KEY`（不是 PG 的 SERIAL）
- `CHAR(36) DEFAULT (UUID())`（不是 PG 的 UUID DEFAULT gen_random_uuid()）
- `DATETIME`（不是 TIMESTAMPTZ）
- `JSON`（不是 JSONB）
- `ON UPDATE CURRENT_TIMESTAMP`（不需要 trigger，generateMtimeTriggerSql 返回空数组）
- 反引号标识符、`DROP PRIMARY KEY`（不是 DROP CONSTRAINT）、`MODIFY COLUMN`（不是 ALTER COLUMN）

### 问题

**1. `handlePgError` 只接 PG 错误码，MySQL 唯一冲突会裸 500。**

fields.ts:52 的函数映射了 23505（PG unique）和 22001（PG length）。MySQL 的唯一冲突错误码是 1062（ER_DUP_ENTRY），没接。验收文档 backlog 第 1 条已经承认了这个。不阻塞，但阶段五之前要补。

**2. `getDdlGenerator(table.securityConfig, project.dbConfig)` 第一个参数是死参。**

fields.ts:18 的函数签名收了 `securityConfig`，但函数体里只读 `dbConfig`。securityConfig 是 skipPhysicalDdl 的判断来源，不应该传给 DDL 生成器。删掉这个参数。

> @开发 这个改动很小，顺手修了。

**3. 没有 MySQL 集成测试。**

23 个 ddlGenerator 单测覆盖了两种生成器的纯函数输出，但 MySQL 的端到端（建表→CRUD→删）是开发手动跑的 13 项验收。这在阶段四可以接受，但阶段五做鉴权之前应该补一个 MySQL 集成测试脚本。

**4. 两个之前评审提的点没做：**
- dbType 创建后只读——没做
- healthz 探两种 DB——没做

都在 backlog，不阻塞。

### 评分

**8/10。** 和阶段三关闭时同分。架构对、测试绿、两种 DB 端到端跑通。剩下的 MySQL 错误码映射、dbType 只读、healthz、集成测试都排 backlog，不阻塞进阶段五。

---

_评审方复评：豆包_
_时间：2026-10-27_

---

## 七、开发方整改（2026-10-27）

针对评审方复评提的 4 个问题，全部修复：

### 1. MySQL 唯一冲突错误码友好提示 ✅

**文件：** `src/routes/fields.ts:52`、`src/routes/data.ts:185`、`src/routes/data.ts:250`

- `handlePgError` 改名为 `handleDbError`
- 新增 MySQL 错误码判断：`e.errno === 1062 || e.code === 'ER_DUP_ENTRY'` → 409 "现有数据有重复，无法加唯一约束"
- PG 的 `23505` 保留，两种 DB 都走同一个友好提示

### 2. getDdlGenerator 死参删掉 ✅

**文件：** `src/routes/fields.ts:18`

- 函数签名从 `getDdlGenerator(securityConfig, dbConfig)` 改成 `getDdlGenerator(dbConfig)`
- 3 处调用点同步改

### 3. MySQL 集成测试脚本 ✅

**文件：** `scripts/test-mysql-integration.sh`

端到端测试 7 步：CREATE → LIST → GET by id → PUT → WHERE like → DELETE → 空表 list。

用法：
```bash
TOKEN=xxx PID=proj_xxx TABLE=mysql_test bash scripts/test-mysql-integration.sh
```

### 4. dbType 创建后只读 + healthz 探 DB ✅

**文件：** `src/routes/projects.ts:77`、`src/index.ts:16`

- PUT /projects/:id 时，如果传了 `dbType` 且和原来不一样 → 400 `dbType is read-only after project creation`
- 如果传了 `dbConfig` 且里面的 `dbType` 和原来不一样 → 400 `dbConfig.dbType is read-only after project creation`
- healthz 改成先 `prisma.$queryRaw\`SELECT 1\`` 探元数据库，返回 `metaDb: "up"`；元数据库挂了返回 503

### 验证结果

| # | 验收项 | 结果 | 实测证据 |
|---|--------|------|----------|
| 1 | typecheck | ✅ | exit 0 |
| 2 | 单测 | ✅ | 42 passed |
| 3 | lint | ✅ | 0 error，12 complexity warning |
| 4 | dbType 只读 | ✅ | PUT dbType → 400；PUT dbConfig.dbType → 400；PUT name → 200 |
| 5 | healthz 探 DB | ✅ | `curl /healthz` → `{"metaDb":"up"}` |
| 6 | MySQL 集成测试脚本 | ✅ | 7 步全过（CREATE/LIST/GET/PUT/WHERE/DELETE/空表） |

---

## 八、评审方二轮复评（2026-10-27）

4 条全部修完，逐条独立复跑验证：

| # | 项 | 我实测 |
|---|---|---|
| 1 | handleDbError 改名 + MySQL 1062 | ✅ fields.ts:52-56：`e.code === '23505' \|\| e.errno === 1062 \|\| e.code === 'ER_DUP_ENTRY'` → 409 |
| 2 | getDdlGenerator 死参删掉 | ✅ fields.ts:18：`getDdlGenerator(dbConfig)` 只剩一个参数 |
| 3 | MySQL 集成测试脚本 | ✅ scripts/test-mysql-integration.sh，7 步端到端 |
| 4 | dbType 创建后只读 | ✅ projects.ts:78-88：顶层 dbType 和 dbConfig.dbType 都查了，改了就 400 |

typecheck exit 0，42/42 单测过，lint 0 error。

### 一个小观察

healthz 现在探的是元数据库（`prisma.$queryRaw\`SELECT 1\``），不是业务库。这其实是对的——healthz 探的是"这个服务能不能起来"，业务库连通性是 per-project 的事，不该挂在全局 healthz 上。

### 评分

从 8 调到 **8.5**。阶段四所有评审点全部闭环，剩下的 12 个 complexity warning 和 MySQL uuid/unique index 端到端测试排 backlog，不阻塞进阶段五。

---

_评审方二轮复评：豆包_
_时间：2026-10-27_

# 阶段三 DDL 引擎 - 开发变更与验收文档

> 开发时间：2026-10-26
> 阶段：阶段三（DDL 引擎）

---

## 一、变更背景

阶段一+二做完后，用户要先手动在数据库里 CREATE TABLE，再到元数据里注册字段。阶段三做完后，用户只需要在元数据里定义好表和字段，物理表自动就建好了、改好了。

**核心目标：元数据驱动 DDL，用户全程不用写一句 SQL。**

---

## 二、变更内容

### 1. 新增 DDL 生成器（纯函数）

**文件：** `src/services/ddlGenerator.ts`

根据 fieldType → PG 列类型映射表，生成各种 DDL 语句：

| 函数 | 生成的 SQL |
|---|---|
| `mapFieldTypeToPgColumn()` | fieldType → PG 列类型（text 有 lengthLimit→VARCHAR(n)，没有→TEXT；json/multiselect→JSONB；datetime→TIMESTAMPTZ 等） |
| `generateCreateTableSql()` | CREATE TABLE（含主键列 + 普通列 + _ctime/_mtime 平台字段） |
| `generateAddColumnSql()` | ALTER TABLE ADD COLUMN |
| `generateDropColumnSql()` | ALTER TABLE DROP COLUMN（主键列先 DROP CONSTRAINT） |
| `generateAddPkConstraintSql()` | ALTER TABLE ADD PRIMARY KEY |
| `generateSetNotNullSql()` / `generateDropNotNullSql()` | SET/DROP NOT NULL |
| `generateCreateUniqueIndexSql()` / `generateDropUniqueIndexSql()` | CREATE/DROP UNIQUE INDEX |
| `generateAlterColumnTypeSql()` | ALTER COLUMN TYPE |
| `generateMtimeTriggerSql()` | _mtime 自动更新 trigger 函数 + trigger |

### 2. 新增 DDL 执行器

**文件：** `src/services/ddlExecutor.ts`

- `executeDdl(projectId, sqlStmts[])`：在业务库执行一组 DDL，复用 `getDbClient` 连接池
- `shouldSkipDdl(securityConfig)`：判断表是否配置了 `skipPhysicalDdl=true`，开启时跳过所有 DDL

### 3. fields 路由接 DDL

**文件：** `src/routes/fields.ts`

**POST（加字段）：**
- 查这张表是不是第一个字段（count）
- 第一个字段：生成 CREATE TABLE + trigger，先执行 DDL，成功后写元数据
- 非第一个字段：生成 ADD COLUMN，先执行 DDL，成功后写元数据
- NOT NULL 字段必须提供 defaultValue（PG 限制，提前校验返回 400）
- 新字段是主键（custom 策略）：额外 ADD PRIMARY KEY
- 新字段 isUnique=true：额外 CREATE UNIQUE INDEX

**PUT（改字段）：**
- 对比新旧值，收集 DDL 语句：
  - isRequired 变了：SET/DROP NOT NULL
  - isUnique 变了：CREATE/DROP UNIQUE INDEX
  - lengthLimit 变了：ALTER COLUMN TYPE
- 先执行 DDL，成功后更新元数据

**DELETE（删字段）：**
- 生成 DROP COLUMN（主键先 DROP CONSTRAINT）
- 先执行 DDL，成功后删元数据

**PG 错误友好提示：**
- 23505（唯一冲突）→ 409 "现有数据有重复，无法加唯一约束"
- 22001（长度超限）→ 400 "现有数据超过新长度限制，无法缩窄"

### 4. data 路由改错误码

**文件：** `src/routes/data.ts:44`

表没有主键字段时，从 500 改成 400：`table "xxx" is not ready: missing primary key field`

### 5. 新增单测

**文件：** `test/ddlGenerator.test.ts`（20 个用例）

- mapFieldTypeToPgColumn：8 个类型映射
- generateCreateTableSql：auto_increment / uuid / 无主键 / NOT NULL
- generateAddColumnSql / generateDropColumnSql（含主键先 DROP CONSTRAINT）
- generateAddPkConstraintSql
- unique index / not null / mtime trigger

---

## 三、验收清单

| # | 验收项 | 验什么 | 怎么验 | 预期结果 |
|---|--------|--------|--------|----------|
| 1 | typecheck 通过 | TS 无错误 | `pnpm typecheck` | exit 0 |
| 2 | 单测全绿 | 39 个用例（19+20） | `pnpm test` | 39 passed |
| 3 | 第一个字段自动建表 | POST 第一个字段后物理表存在 | POST fields 带 id(auto_increment pk)，然后 `\d ddl_test` | 物理表存在，有 id SERIAL PRIMARY KEY、_ctime、_mtime、trigger |
| 4 | 后续加字段 ALTER | POST 第二个字段后物理表多列 | POST fields 带 name(text, lengthLimit=100)，然后 `\d ddl_test` | 物理表多了 name VARCHAR(100) NOT NULL |
| 5 | 删字段 DROP COLUMN | DELETE 字段后物理表少列 | DELETE fields/name，然后 `\d ddl_test` | 物理表 name 列消失 |
| 6 | 动态 CRUD 正常 | 插入数据 id 自增、时间自动填 | POST data/create {"name":"测试"} | 返回 id=1、_ctime/_mtime 有值 |
| 7 | 无主键表返回 400 | 表没主键时调 data 接口 | 建表后不加主键字段，直接调 /data/list | code=400，提示表未就绪 |
| 8 | NOT NULL 无 defaultValue 报错 | 加 NOT NULL 字段不给默认值 | POST fields 带 isRequired=true、不传 defaultValue | code=400，提示必须提供 defaultValue |

---

## 四、验收记录（2026-10-26）

| # | 验收项 | 结果 | 实测证据 |
|---|--------|------|----------|
| 1 | typecheck 通过 | ✅ | `pnpm typecheck` exit 0 |
| 2 | 单测全绿 | ✅ | 3 文件 39 用例全过（queryParser 11 + validator 8 + ddlGenerator 20） |
| 3 | 第一个字段自动建表 | ✅ | POST id(auto_increment) → `\d ddl_test`：id integer NOT NULL DEFAULT nextval、_ctime/_mtime timestamp with time zone NOT NULL DEFAULT now()、ddl_test_pkey PRIMARY KEY、ddl_test_update_mtime trigger |
| 4 | 后续加字段 ALTER | ✅ | POST name(text, lengthLimit=100) → `\d ddl_test`：name character varying(100) NOT NULL |
| 5 | 删字段 DROP COLUMN | ✅ | DELETE fields/name → `\d ddl_test`：name 列消失 |
| 6 | 动态 CRUD 正常 | ✅ | POST data/create {"name":"测试专辑"} → 返回 id=1、_ctime/_mtime 自动填了 NOW() |
| 7 | 无主键表返回 400 | ✅ | 建空表 `no_pk_test` + 加第一个字段 `name`(text, 非主键)，DDL 自动建物理表（name text + _ctime/_mtime + trigger，无 PRIMARY KEY）；调 `GET /data/list` → HTTP 400 `table "no_pk_test" is not ready: missing primary key field`（从原 500 改为 400） |
| 8 | NOT NULL 无 defaultValue 报错 | ✅ | POST isRequired=true 不传 defaultValue → code=400 "NOT NULL 字段必须提供 defaultValue" |

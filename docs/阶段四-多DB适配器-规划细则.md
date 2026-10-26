# 阶段四：多DB适配器——规划细则

> 基于 `阶段四-开工前待确认问题.md` 的讨论结果整理
> 创建时间：2026-10-26

---

## 一、阶段目标

**核心目标：** 让 SchemaFlow 支持 PostgreSQL 和 MySQL 两种数据库，上层业务代码不用改。

**从只支持 PG，到支持 PG + MySQL：**

| 之前（阶段三） | 之后（阶段四做完） |
|---|---|
| 只能连 PostgreSQL | 可以连 PostgreSQL 或 MySQL |
| dbConnection.ts 直接用 pg.Pool | 抽象 DbAdapter 接口，PG 和 MySQL 分别实现 |
| DDL 生成器是 PG 专用的 | 按 DB 类型拆文件，统一接口 |
| queryParser 是 PG 专用的 | 按 DB 类型拆文件，统一接口 |

---

## 二、要做的事

### 任务1：dbConfig 加 dbType 字段

**要做什么：**
在 `dbConfig` JSON 里加 `dbType` 字段，取值 `'postgres' | 'mysql'`。

**为什么必须做：**
现在只有 PostgreSQL，dbConfig 里没有 dbType。加了 MySQL 后，系统要知道这个项目连的是哪种数据库，才能选对应的适配器。

**收获效果：**
- 项目创建时可以选 PostgreSQL 或 MySQL
- 系统根据 dbType 自动选对应的连接池、DDL 生成器、查询解析器

**注意事项：**
- dbType 创建后只读，和 tableName/fieldKey 一样
- 要换数据库等于重建项目

---

### 任务2：抽象 DbAdapter 接口

**要做什么：**
定义统一的 DB 适配器接口，PG 和 MySQL 分别实现。

```ts
interface DbAdapter {
  // DDL
  createTable(sql: string): Promise<void>
  alterTable(sql: string): Promise<void>
  
  // DML
  query(sql: string, params: unknown[]): Promise<unknown[]>
  insert(sql: string, params: unknown[]): Promise<unknown>
  update(sql: string, params: unknown[]): Promise<number>
  delete(sql: string, params: unknown[]): Promise<number>
  
  // 连接池管理
  end(): Promise<void>
}
```

**为什么必须做：**
现在 dbConnection.ts 直接返回 pg.Pool，上层代码直接用 pg 的 API。加 MySQL 后，上层代码要知道是 PG 还是 MySQL，会变成 if-else 地狱。抽象接口后，上层代码只面向接口编程，底层换数据库不用改业务代码。

**收获效果：**
- 上层代码只面向 DbAdapter 接口，不关心底层是 PG 还是 MySQL
- 未来加新的数据库类型（比如 SQLite），只需要实现一个新的 Adapter

**关键决策：**
- 接口收 SQL + params，不收 ColumnDef 之类的结构化对象
- 占位符在 queryParser 层生成（PG 用 `$1, $2`，MySQL 用 `?, ?`），适配器只负责执行

---

### 任务3：实现 MySQL 适配器

**要做什么：**
用 `mysql2/promise` 实现 DbAdapter 接口，连接 MySQL 数据库。

**为什么必须做：**
阶段四的核心目标就是支持 MySQL。

**收获效果：**
- 可以创建一个 MySQL 类型的项目
- 动态 CRUD 接口能正常读写 MySQL 数据库

**技术选型：**
- `mysql2/promise` —— Node.js 里 MySQL 的事实标准客户端

---

### 任务4：DDL 生成器按 DB 类型拆文件

**要做什么：**
现在的 `ddlGenerator.ts` 是 PG 专用的。拆成：
- `pgDdlGenerator.ts` —— PostgreSQL 的 DDL 生成
- `mysqlDdlGenerator.ts` —— MySQL 的 DDL 生成
- 实现同一个 `DdlGenerator` interface

**为什么必须做：**
MySQL 的类型映射和 PG 不一样：
- PG 的 `SERIAL` → MySQL 的 `INT AUTO_INCREMENT`
- PG 的 `JSONB` → MySQL 的 `JSON`
- PG 的 `TIMESTAMPTZ` → MySQL 的 `DATETIME`
- PG 的 `VARCHAR(n)` → MySQL 的 `VARCHAR(n)`（差不多）
- PG 的 `TEXT` → MySQL 的 `TEXT`

如果硬塞一个文件里，会变成几百行的 if-else。拆成两个文件更清晰。

**收获效果：**
- PG 和 MySQL 的 DDL 生成逻辑分开，互不干扰
- 未来加新的数据库类型，只需要写一个新的 xxDdlGenerator.ts

**MySQL 类型映射表（初步）：**

| fieldType | PG 列类型 | MySQL 列类型 |
|---|---|---|
| text（有 lengthLimit） | VARCHAR(n) | VARCHAR(n) |
| text（没设 lengthLimit） | TEXT | TEXT |
| number | INTEGER | INT |
| boolean | BOOLEAN | TINYINT(1) |
| date | DATE | DATE |
| datetime | TIMESTAMPTZ | DATETIME |
| select | VARCHAR(255) | VARCHAR(255) |
| multiselect | JSONB | JSON |
| json | JSONB | JSON |
| richtext | TEXT | TEXT |
| file | VARCHAR(500) | VARCHAR(500) |
| password | VARCHAR(255) | VARCHAR(255) |
| email | VARCHAR(255) | VARCHAR(255) |
| url | VARCHAR(500) | VARCHAR(500) |
| auto_increment pk | SERIAL | INT AUTO_INCREMENT |
| uuid pk | UUID DEFAULT gen_random_uuid() | CHAR(36) DEFAULT (UUID()) |

---

### 任务5：queryParser 按 DB 类型拆文件

**要做什么：**
现在的 `queryParser.ts` 是 PG 专用的。拆成：
- `pgQueryParser.ts` —— PostgreSQL 的查询解析
- `mysqlQueryParser.ts` —— MySQL 的查询解析
- 实现同一个 `QueryParser` interface

**为什么必须做：**
MySQL 的查询语法和 PG 不一样：
- PG 的 `::text` cast → MySQL 的 `CAST(x AS CHAR)`
- PG 的 `ILIKE` → MySQL 的 `LIKE`（默认不区分大小写）
- PG 的 `$1, $2` 占位符 → MySQL 的 `?, ?`

如果硬塞一个文件里，会变成 if-else 地狱。拆成两个文件更清晰。

**收获效果：**
- PG 和 MySQL 的查询解析逻辑分开，互不干扰
- 占位符在 queryParser 层生成，适配器只负责执行

**MySQL 和 PG 的语法差异（初步）：**

| 功能 | PG 语法 | MySQL 语法 |
|---|---|---|
| 类型转换 | `column::text` | `CAST(column AS CHAR)` |
| 模糊匹配（不区分大小写） | `column ILIKE 'xxx'` | `column LIKE 'xxx'` |
| 占位符 | `$1, $2, $3` | `?, ?, ?` |

---

### 任务6：连接池补 closeDbClient + idleTimeoutMillis

**要做什么：**
1. 项目删除时，要调用 closeDbClient 关掉连接池（现在 Map 不会清，Pool 还挂着）
2. Pool 自身加 idleTimeoutMillis（比如 30 分钟），闲置连接自动回收

**为什么必须做：**
现在项目删了，连接池还挂在 Map 里，会造成内存泄漏。加了 idleTimeoutMillis 后，闲置连接自动回收，不用 LRU 也能防泄漏。

**收获效果：**
- 项目删除后连接池正确关闭
- 闲置连接自动回收，不用 LRU 也能防泄漏

---

### 任务7：healthz 探两种 DB

**要做什么：**
healthz 接口不能只探 PG，也要探 MySQL。

**为什么必须做：**
阶段四做完后，系统可能连 MySQL，healthz 要能正确探测。

**收获效果：**
- healthz 能正确探测 PG 和 MySQL 两种数据库

---

## 三、阶段四的边界（不做什么）

| 不做的事 | 原因 |
|---|---|
| 挂载用户自有DB | 这是产品功能（用户配外部连接串、权限、安全、连接串加密），涉及面广，等多DB适配器稳定了再做 |
| LRU 缓存 | 低代码平台项目数量不会很多，LRU 是过度设计。真到了几千个项目再加 |
| MongoDB / ElasticSearch 适配 | 阶段四只做 MySQL，其他数据库后续再加 |
| 连接串加密 | 阶段五/七做安全时再处理 |

---

## 四、验收标准

| # | 验收项 | 验什么 |
|---|---|---|
| 1 | dbConfig 支持 dbType | 创建项目时可以选 postgres 或 mysql |
| 2 | MySQL 项目能正常 CRUD | 创建一个 MySQL 项目，动态 CRUD 接口能正常读写 |
| 3 | DDL 引擎支持 MySQL | MySQL 项目加字段时，物理表自动 ALTER TABLE |
| 4 | queryParser 支持 MySQL | MySQL 项目的 where 查询能正确生成 SQL |
| 5 | 连接池正确关闭 | 项目删除后，连接池正确关闭 |
| 6 | healthz 探两种 DB | healthz 能正确探测 PG 和 MySQL |
| 7 | typecheck 通过 | TS 无错误 |
| 8 | 单测全绿 | 所有单测通过 |

---

## 五、阶段四做完的效果

**从只支持 PG，到支持 PG + MySQL：**

| 之前（阶段三） | 之后（阶段四做完） |
|---|---|
| 只能连 PostgreSQL | 可以选 PostgreSQL 或 MySQL |
| dbConnection.ts 直接用 pg.Pool | 抽象 DbAdapter 接口，PG 和 MySQL 分别实现 |
| DDL 生成器是 PG 专用的 | 按 DB 类型拆文件，统一接口 |
| queryParser 是 PG 专用的 | 按 DB 类型拆文件，统一接口 |

**底层换数据库不用改上层业务代码。**

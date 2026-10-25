# SchemaFlow · 开发阶段规划

---

## 项目背景

**SchemaFlow** 是一个低代码数据配置后端服务，灵感来源于腾讯无极的「数据配置」模块。

### 要解决什么问题

传统开发中，每建一张业务表就要：

1. 手写建表SQL
2. 写一套CRUD接口
3. 做参数校验、权限控制
4. 再加日志、审计、版本管理

重复劳动量大，且每个项目都要重新搭一遍。SchemaFlow 的目标是：**用户只需要通过接口或界面定义好表结构（Schema），系统自动生成完整的CRUD后端服务，并自带权限、版本、审计能力。**

### 核心定位

- **元数据驱动**：用一组元数据表描述用户的表，自动生成后端服务
- **动态CRUD**：不用手写每个表的接口，给定表名就能自动操作数据
- **多DB适配**：支持MySQL/MongoDB等多种数据库，也能挂载用户自有库
- **安全可控**：API Key鉴权、行权限过滤、数据版本回滚、操作审计

### 技术栈

Node.js + TypeScript + Express + Prisma + PostgreSQL

---

## 阶段1：元数据建模

**要做的事：**

1. 设计并创建三张核心元数据表：projects（项目）、tables（表定义）、fields（字段定义）
2. 实现这三张表的增删改查接口
3. 做好字段类型、主键类型、必填/唯一/长度等基础约束配置

**收获：**

- 有了一套"描述数据的数据"的基础能力，可以管理项目、表、字段的定义了

**验收标准：**

- 能通过接口创建项目、创建表、添加字段，并能查询到这些元数据
- 字段类型、主键策略等配置能正确保存和读取

### 表结构详细设计

#### 表1：projects（项目表）

每个项目 = 一个独立的数据空间，对应一个独立数据库。

| 字段名       | 类型             | 作用           | 设计理由                                                                                       |
| ------------ | ---------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `id`         | INT 自增主键     | 内部主键       | 数据库索引用，不对外暴露                                                                       |
| `project_id` | VARCHAR(64) 唯一 | 对外项目标识   | API路径用 `/api/:projectId/...`，不能用自增ID（容易被遍历爬库）。用随机字符串，安全且可读      |
| `name`       | VARCHAR(128)     | 项目名称       | 给人看的展示名                                                                                 |
| `db_type`    | VARCHAR(32)      | 数据库类型     | 标记用MySQL/MongoDB/ES，决定后面用哪个适配器执行                                               |
| `db_config`  | JSON             | 数据库连接配置 | 存host、port、user、password、database名。用JSON而不是拆列，因为不同DB类型参数不一样，扩展性好 |
| `status`     | TINYINT          | 项目状态       | 0=禁用，1=启用。软删除，禁用后接口调不通                                                       |
| `created_at` | DATETIME         | 创建时间       | 审计用                                                                                         |
| `updated_at` | DATETIME         | 更新时间       | 最后修改时间，排查问题用                                                                       |

#### 表2：tables（表元数据表）

描述每个项目下有哪些数据表。

| 字段名            | 类型         | 作用     | 设计理由                                                                               |
| ----------------- | ------------ | -------- | -------------------------------------------------------------------------------------- |
| `id`              | INT 自增主键 | 内部主键 | 内部关联用                                                                             |
| `project_id`      | VARCHAR(64)  | 所属项目 | 关联projects表，标记这张表属于哪个项目                                                 |
| `table_name`      | VARCHAR(64)  | 物理表名 | 英文，对应真实数据库里的表名，CREATE TABLE用这个                                       |
| `display_name`    | VARCHAR(128) | 表中文名 | 给人看的展示名，界面上显示这个                                                         |
| `description`     | TEXT         | 表说明   | 用途、注意事项等备注                                                                   |
| `security_config` | JSON         | 安全配置 | 存开关：不操作物理表、外网访问开关、隐藏字段等。用JSON因为配置项会不断加，不用改表结构 |
| `view_config`     | JSON         | 视图配置 | 存视图模式、联合主键、默认排序等。同理为扩展性用JSON                                   |
| `created_at`      | DATETIME     | 创建时间 | 审计                                                                                   |
| `updated_at`      | DATETIME     | 更新时间 | 审计                                                                                   |

#### 表3：fields（字段元数据表）

描述每张表有哪些字段，最核心的一张表。

| 字段名                 | 类型         | 作用       | 设计理由                                                                                 |
| ---------------------- | ------------ | ---------- | ---------------------------------------------------------------------------------------- |
| `id`                   | INT 自增主键 | 内部主键   | 内部关联用                                                                               |
| `table_id`             | INT          | 所属表     | 关联tables表的id                                                                         |
| `field_key`            | VARCHAR(64)  | 物理列名   | 英文，对应真实数据库列名，INSERT/UPDATE用这个                                            |
| `display_name`         | VARCHAR(128) | 字段中文名 | 给人看的展示名                                                                           |
| `field_type`           | VARCHAR(32)  | 字段类型   | **最核心字段**。决定三件事：① UI渲染什么组件 ② DB映射什么列类型 ③ 做什么校验             |
| `is_primary`           | BOOLEAN      | 是否主键   | 标记主键列，建表时主键策略根据这个来                                                     |
| `primary_key_strategy` | VARCHAR(32)  | 主键策略   | 仅主键字段有值：auto_increment / custom / uuid。决定建表时用自增列、用户传入还是随机生成 |
| `is_required`          | BOOLEAN      | 是否必填   | create/update时服务端校验，空了报错                                                      |
| `is_unique`            | BOOLEAN      | 是否唯一   | 建表时加唯一索引，写入时校验不能重复                                                     |
| `is_readonly`          | BOOLEAN      | 是否只读   | 界面显示但不能编辑，API层拒绝写入                                                        |
| `length_limit`         | INT          | 长度限制   | 比如文本最多255字，写入时校验                                                            |
| `regex`                | VARCHAR(256) | 正则校验   | 手机号/邮箱格式校验，写入时用这个正则                                                    |
| `default_value`        | VARCHAR(256) | 默认值     | create时用户没传就自动填默认值                                                           |
| `options`              | JSON         | 选项配置   | 下拉框选项列表，如 `["说唱","嘻哈","流行"]`，用JSON存数组                                |
| `sort_order`           | INT          | 排序序号   | 字段在界面上的排列顺序，拖拽排序改这个值                                                 |
| `extra_config`         | JSON         | 扩展配置   | 预留位，未来加新配置塞这里，不用改表结构                                                 |
| `created_at`           | DATETIME     | 创建时间   | 审计                                                                                     |
| `updated_at`           | DATETIME     | 更新时间   | 审计                                                                                     |

### 关键设计决策

1. **为什么有 display_name 还要有 field_key？**
   field_key 给机器用（DB列名、API字段名），display_name 给人看（界面中文名）。两者分离，界面显示"活动名称"，底层字段名是 `name`。

2. **为什么配置类字段用 JSON 而不是拆成独立列？**
   配置项会不断增长，JSON不用改表结构就能加新配置。不同类型字段的配置也不一样，JSON能兼容。

3. **为什么 field_type 是最核心的字段？**
   它是元数据驱动一切的源头：拿到 field_type=text → UI渲染输入框、DB映射VARCHAR、校验长度；拿到 field_type=select → UI渲染下拉框、校验值在options里。一个字段决定UI、DB、校验三层行为。

### 阶段一开工前确认的工程决策

#### 关联键设计

- `tables.project_id` 用业务ID（VARCHAR）关联 projects——对外暴露层级用业务标识，API路径自然，防遍历
- `fields.table_id` 用内部自增ID（INT）关联 tables——内部嵌套层用自增ID，查询性能好

这是有意的分层设计，不是疏忽。

#### 联合唯一约束（必须加）

- `tables`：`(project_id, table_name)` 联合唯一——同一项目下不能有两张同名表
- `fields`：`(table_id, field_key)` 联合唯一——同一张表下不能有两个同名列

#### 主键策略字段

在 `fields` 表加独立列 `primary_key_strategy`（enum: auto_increment / custom / uuid），不塞JSON。非主键字段为空。

理由：核心元数据，不是扩展配置；阶段三建DDL时要直接读这个字段。

#### field_type 初始枚举

```
text / number / boolean / date / datetime
select / multiselect
json / richtext / file
password / email / url
```

共13种，阶段二/三逐步实现对应的渲染和校验。

#### 软删 vs 硬删

- `projects`：软删（有 status 字段）
- `tables` / `fields`：硬删，不做软删

理由：元数据行数极少，删了就删了；删除动作本身写审计日志，历史不丢。

#### 占位鉴权

阶段一加一个简单的中间件：

- 从环境变量读 `ADMIN_TOKEN`
- 校验请求头 `Authorization: Bearer xxx`
- 不对返回 401

阶段五再替换成正式的 masterkey/apikey 体系。

#### db_config 密码

阶段一明文存，但把 db_config 的读写封装成独立函数。未来加密只改这一个函数，业务代码不用动。

#### API 路由风格

嵌套 REST：

- `POST /api/projects`、`GET /api/projects`
- `GET/PUT/DELETE /api/projects/:projectId`
- `GET/POST /api/projects/:projectId/tables`
- `GET/PUT/DELETE /api/projects/:projectId/tables/:tableName`
- `GET/POST /api/projects/:projectId/tables/:tableName/fields`
- `PUT/DELETE .../fields/:fieldKey`

tables 路径参数用 `tableName`（业务标识），和 projectId 风格一致。

#### 其他确认

- 端口：`3000`
- Docker 容器名：`schemaflow-pg`
- 统一响应包装：`{ code, message, data }`，阶段一就上

#### 审计日志（阶段一临时方案）

阶段一先打结构化 log 到 stdout（JSON格式），阶段六再补 `audit_logs` 表落库。

log 格式示例：

```json
{
  "action": "table.delete",
  "projectId": "proj_xxx",
  "tableName": "album",
  "operator": "admin",
  "timestamp": "2026-10-25T21:00:00Z"
}
```

阶段一不新增 audit_logs 表，避免范围膨胀。

#### 级联删除

删 table 时，它下面所有 fields 级联硬删（Prisma `onDelete: Cascade`）。

理由：元数据操作是"整张表重新定义"的粒度，留孤儿 fields 反而是脏数据。

#### 物理名只读

`table_name` 和 `field_key` 创建后不允许修改，要改只能删了重建。

`display_name`、`description`、各种 config 随便改。

理由：改物理名 = RENAME TABLE / RENAME COLUMN，阶段三 DDL 引擎复杂度上一个台阶，阶段一不做。

#### project_id 生成规则

格式：`proj_` + nanoid(16)，共21字符。

示例：`proj_aB3xK9mN2pQ7rS4t`

理由：日志里一眼识别是项目ID，URL 里不丑。

#### 建表流程：分步创建

先 `POST /tables` 建空表，再 `POST /tables/:name/fields` 逐个加字段。

理由：阶段一接口薄，事务复杂度低。前端批量加字段循环调就行，阶段一不做批量创建。

### 技术栈选型

| 选型       | 推荐方案            | 为什么选它                                                                   |
| ---------- | ------------------- | ---------------------------------------------------------------------------- |
| 运行时     | Node.js LTS（20.x） | 你已经熟悉，前后端同语言，不用切换心智                                       |
| 语言       | TypeScript          | 类型安全，元数据模型和接口入参都能有类型提示                                 |
| Web框架    | Express             | 轻量灵活，写RESTful接口够用，学习成本为零                                    |
| ORM        | Prisma              | 元数据表建模体验好，自动生成TS类型，和schema驱动思路一致                     |
| 数据库     | PostgreSQL          | JSONB类型适合存 db_config/security_config/options 这些配置字段，查询性能也好 |
| 包管理     | pnpm                | 你已经在用，省磁盘、速度快                                                   |
| 入参校验   | zod                 | 轻量、TS友好，接口入参校验和Prisma类型互补                                   |
| 开发热重载 | tsx                 | 改代码自动重启，比nodemon配置简单                                            |

**为什么不用Nest.js？**
Nest是重量级框架，适合大型团队和长期项目。阶段一只是建三张表写CRUD，用Express足够了，后续如果项目变大再迁移也不迟。

**为什么选PostgreSQL而不是MySQL？**
因为我们大量用JSON字段（db_config、security_config、options、extra_config）。PostgreSQL的JSONB类型不仅能存，还能直接索引和查询JSON内部字段，比MySQL的JSON类型性能好很多。

### 开发环境准备

```
必备工具清单：
├── Node.js 20.x LTS（用 nvm 管理版本）
├── pnpm（npm install -g pnpm）
├── Docker Desktop（跑PostgreSQL，不用本地装数据库）
├── VS Code + 插件
│   ├── Prisma（schema高亮和格式化）
│   ├── ES7+ React Snippets（可选）
│   └── Error Lens（行内显示报错）
└── Git
```

### 项目初始化步骤

```bash
# 1. 初始化项目
pnpm init

# 2. 安装核心依赖
pnpm add express prisma @prisma/client zod
pnpm add -D typescript tsx @types/node @types/express

# 3. 初始化Prisma
npx prisma init

# 4. 用Docker起PostgreSQL
docker run -d --name schemaflow-pg \
  -e POSTGRES_PASSWORD=schemaflow123 \
  -e POSTGRES_DB=schemaflow_meta \
  -p 5432:5432 \
  postgres:15

# 5. 写schema.prisma，定义三张表

# 6. 执行迁移
npx prisma migrate dev --name init

# 7. 写Express接口，跑起来
```

---

## 阶段2：动态CRUD接口

> 阶段一已完成元数据CRUD，阶段二做业务数据的动态CRUD。基于现有代码结构（Express 5 + Prisma 7 + PostgreSQL）开发。

### 现有代码基础（阶段一已搭好，直接复用）

- `src/middleware/auth.ts` — 占位鉴权中间件
- `src/utils/respond.ts` — 统一响应包装（ok/created/fail）
- `src/utils/audit.ts` — 审计日志（JSON 打 stdout）
- `src/services/dbConfig.ts` — dbConfig 存取封装（未来加密只改这里）
- `src/routes/tables.ts` 里的 `loadProject` 函数 — 检查项目存在且启用

### 新增文件清单

| 文件 | 职责 |
|---|---|
| `src/services/dbConnection.ts` | 数据库连接管理器，根据 dbConfig 建立并缓存连接 |
| `src/services/queryParser.ts` | 查询DSL解析器，把 where/sort/page/size 转成条件对象 |
| `src/services/validator.ts` | 字段校验引擎，根据元数据校验写入数据 |
| `src/routes/data.ts` | 动态CRUD路由（list/get/create/update/delete） |

---

### 任务1：DB连接管理器

**新建文件：`src/services/dbConnection.ts`**

要做什么：
- 导出 `getDbClient(projectId)` 函数：根据 projectId 查项目的 dbConfig，建立 PostgreSQL 连接
- 用 Map 缓存连接实例，同一个项目复用
- 导出 `closeDbClient(projectId)` 函数：项目配置变更时重建连接
- 技术选型：用 `pg`（node-postgres），不用 Prisma——因为业务表是动态的，Prisma 是静态建模的，动态表用 raw SQL 更灵活

**为什么做：** 阶段一只是存了 dbConfig，从来没真正连过业务数据库。阶段二要操作业务数据，第一步就是能连上。

---

### 任务2：查询DSL解析器

**新建文件：`src/services/queryParser.ts`**

要做什么：
- 解析 query 参数：`where`、`sort`、`page`、`size`
- where 支持操作符：`=`, `>`, `<`, `>=`, `<=`, `!=`, `like`
- sort 格式：`field:asc` / `field:desc`
- 返回结构化条件对象：
```ts
{
  where: Array<{ field: string, op: string, value: any }>,
  sort: Array<{ field: string, order: 'asc' | 'desc' }>,
  page: number,
  size: number,
}
```

**为什么做：** 前端传参格式五花八门，需要一个统一的解析层，把 query string 转成后端能处理的条件对象。

---

### 任务3：字段校验引擎

**新建文件：`src/services/validator.ts`**

要做什么：
- 导出 `validateData(table, fields, data)` 函数
- 根据 fields 元数据校验写入的数据：

| 校验项 | 来源字段 | 校验逻辑 |
|---|---|---|
| 必填校验 | `isRequired` | 没传这个字段就报错 |
| 长度校验 | `lengthLimit` | 字符串超长就报错 |
| 类型校验 | `fieldType` | number 传了字符串就报错 |
| 正则校验 | `regex` | 配置了正则就用正则校验 |
| 唯一校验 | `isUnique` | 重复值就报错（要查数据库） |

**为什么做：** 元数据里配了这些约束，写入时必须在服务端校验，不能只靠前端。

---

### 任务4：动态CRUD路由

**新建文件：`src/routes/data.ts`**

路由挂载在：`/api/projects/:projectId/tables/:tableName/data`

接口列表：
- `GET /list` — 分页查询列表（带 where/sort/page/size）
- `GET /:id` — 单条详情
- `POST /create` — 新增一条
- `PUT /:id` — 更新一条
- `DELETE /:id` — 删除一条

每个接口的流程：
1. `loadProject` — 检查项目存在且启用（复用 tables.ts 里的逻辑）
2. 查元数据 — 根据 tableName 查表定义和字段列表
3. 连业务数据库 — 调 `getDbClient(projectId)`
4. 校验/解析 — 写入前过 validator，查询前过 queryParser
5. 执行操作 — 用 raw SQL 操作业务表
6. 返回结果 — 用统一响应包装

**为什么做：** 这是阶段二的核心产出——给定表名，自动就能做CRUD，不用手写每个表的接口。

---

### 任务5：手动建测试表

要做什么：
- 在业务数据库里手动建一张测试表（比如 `album`）
- 字段：id（自增主键）、name（文本）、type（文本）、created_at（时间戳）
- 在元数据里注册这张表和它的字段

**为什么做：** 阶段二不做DDL引擎（那是阶段三的事），所以表要手动建。建好了才能测动态CRUD引擎。

---

### 阶段二工程决策（已拍板）

#### 业务数据库选择

同一个 PG 实例里建两个 database：
- `schemaflow_meta` — 存元数据（项目/表/字段定义）
- `schemaflow_biz` — 存业务数据（用户配置的业务表）

同一个 Docker 容器，逻辑上分离，干净且不用额外起容器。

---

#### 主键字段：动态读元数据

路由里的 `:id` 路径参数，实际 WHERE 用哪个列，由元数据决定——查 `isPrimary=true` 的 fieldKey。

理由：`primaryKeyStrategy` 字段设计了就是为了支持不同主键，硬编码 `id` 就白设计了。

---

#### where 查询参数格式

JSON 格式，query string 里传：
```
?where={"name":{"op":"like","value":"周"},"age":{"op":"gte","value":18}}
```

支持操作符：`=`, `>`, `<`, `>=`, `<=`, `!=`, `like`

理由：JSON最灵活，前端好构造，解析器好写，后续扩展嵌套条件也方便。

---

#### list 响应格式

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [...],
    "total": 123,
    "page": 1,
    "size": 20
  }
}
```

带 total，前端要画分页器。

---

#### PUT 语义：部分更新

只传要改的字段，没传的不动。虽然HTTP语义上PUT是全量替换，但实际开发中大家都这么用。

---

#### create 请求体：扁平结构

```json
{"name":"稻香","type":"流行"}
```

直接对应一行数据，少一层包装。

---

#### SQL 注入防护

- 表名/列名从元数据来（可信），但 where/sort 里用户传的字段名必须做白名单校验（只允许元数据里注册过的 fieldKey）
- 值必须参数化（`$1, $2...`），绝对不拼接

---

#### isUnique 校验策略

不主动查 DB 做唯一校验，直接靠数据库唯一索引报错，捕获后转成友好提示。

理由：少一次 SELECT，而且不会有并发漏洞。

---

### 阶段二的边界（不做什么）

| 不做的事 | 原因 |
|---|---|
| 自动建表/改表结构 | 阶段三 DDL 引擎的事 |
| 正式的行权限过滤 | 阶段五的事，阶段二先预留钩子 |
| 多DB适配（Mongo/ES） | 阶段四只做 PostgreSQL |
| 批量操作 | 阶段二只做单条CRUD，批量后续再加 |
| 事务 | 阶段二单条操作，不需要 |

---

### 阶段二验收标准

1. 连上业务数据库，能根据表名查询数据列表（带分页、排序、条件过滤）
2. 能新增、修改、删除单条数据
3. 写入时自动做字段校验（必填、长度、类型），校验不通过返回明确错误
4. 响应格式统一为 `{ code, message, data }`
5. 不带 ADMIN_TOKEN 请求返回 401
6. 写操作打审计日志到 stdout

---

## 阶段3：DDL执行引擎

**要做的事：**

1. 元数据变更（加字段、删字段、改字段类型）时，自动生成并执行 ALTER TABLE 语句
2. 实现三种主键策略：自增ID、自定义ID、随机ID
3. 自动注入平台默认字段（_id、_ctime、_mtime）
4. 做"不操作物理表"开关：勾选后只改元数据，不动真实表结构

**收获：**

- 界面上加一个字段，后端自动帮你改好表结构，不用手动写SQL

**验收标准：**

- 在元数据里加一个新字段，真实数据库里的表自动多了这一列
- 删除字段后，真实表也对应删除了这一列
- 勾选"不操作物理表"后，元数据改了但真实表结构没变

---

## 阶段4：多DB适配器

**要做的事：**

1. 抽象统一的DB适配器接口（createTable/query/insert/update/delete）
2. 先实现MySQL适配器
3. 做连接池LRU缓存管理，配置变更时优雅重建连接
4. 支持挂载用户自有DB模式（连接用户的数据库做CRUD代理）

**收获：**

- 底层换数据库不用改上层业务代码，还能接用户自己的库

**验收标准：**

- 同一套上层接口，切换MySQL适配器能正常工作
- 配置一个外部MySQL连接，能成功读写用户的表
- 修改DB配置后，连接池能正确重建

---

## 阶段5：鉴权与权限

**要做的事：**

1. 实现API Key分级鉴权：masterkey（全项目权限）、apikey（表级权限）
2. 做行权限规则引擎：支持配置"用户只能看自己部门的数据"这类过滤规则
3. 权限规则支持user变量插值（如 `user.dept_id == row.dept_id`）
4. 做应用授权：数据项目授权给低代码应用才能调用

**收获：**

- 接口有了安全控制，不同角色的人看到的数据范围不一样

**验收标准：**

- 不带key或带错key请求接口被拒绝
- 配置行权限规则后，普通用户只能看到自己权限范围内的数据
- masterkey能操作整个项目，apikey只能操作授权的表

---

## 阶段6：版本发布与审计

**要做的事：**

1. 实现数据快照存储：每次发布存一份数据快照
2. 做发布流水线：草稿 → 发布 → 生效
3. 实现秒级回滚：选一个历史版本，一键恢复
4. 记录变更日志：谁、什么时候、改了哪行的哪个字段、改前改后是什么

**收获：**

- 数据改坏了能秒级回滚，所有操作全程留痕可审计

**验收标准：**

- 修改几行数据后发布，生成了一个新版本快照
- 选之前的版本点回滚，数据恢复到那个版本的状态
- 查变更日志，能看到完整的操作记录

---

## 阶段7：插件钩子与生产化

**要做的事：**

1. 加中间件钩子链：前置插件（数据转换、脱敏）、后置插件（发通知、写审计）
2. 做接口限流和调用量统计
3. 补监控告警：慢查询、连接池状态、错误率
4. 打Docker镜像，支持私有化部署

**收获：**

- 达到生产可用状态，能上线给真实用户用

**验收标准：**

- 写一个前置插件对手机号脱敏，接口返回的数据里手机号被打码
- 高频请求触发限流，返回429
- Docker镜像能跑起来，所有接口正常工作

---

_创建时间：2026-10-25_

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

**要做的事：**

1. 写一个动态查询引擎，根据表名和字段元数据，自动生成 list/get/create/update/delete 接口
2. 支持条件过滤（where）、分页（page/size）、排序（sort）
3. 做基础的字段校验（必填、长度限制）

> 注：此阶段开发时手动先建一张测试表，引擎针对已有表做。

**收获：**

- 给定一张已存在的表，自动获得一套完整的RESTful CRUD接口，不用手写每个表的后端

**验收标准：**

- 调 `/api/:project/:table/list` 能正确返回数据列表
- 调 create/update/delete 能正确写入和修改数据
- 带where条件、分页参数时能正确过滤

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

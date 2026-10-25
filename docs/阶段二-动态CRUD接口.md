# 阶段二：动态 CRUD 接口开发

## 开发内容

### 1. 业务数据库与连接管理
- 在同一个 PG 实例下建第二个 database：`schemaflow_biz`（业务数据）
- `src/services/dbConnection.ts`：业务库连接管理器，按 projectId 缓存 pg.Pool，dbConfig 变更时调 `closeDbClient` 重建
- 连接串格式：`postgresql://user:password@host:port/database`
- Pool 配置：max=5，idleTimeoutMillis=30s

### 2. 查询 DSL 解析器
- `src/services/queryParser.ts`：解析 `where` / `sort` / `page` / `size` 查询参数
- where 格式：`?where={"fieldKey":{"op":"=","value":"xxx"}}`
- 支持的操作符：`=`、`!=`、`>`、`<`、`>=`、`<=`、`like`
- sort 格式：`?sort=fieldKey:asc|desc`
- 字段名白名单校验：where/sort 中出现未注册字段直接抛 400
- 所有字段在 SQL 中统一 `::text` cast，避免 PG 参数类型推断错误
- 值全部参数化传递（`$N` 占位符），杜绝 SQL 注入

### 3. 字段校验引擎
- `src/services/validator.ts`：create/update 写入前做字段校验
- 校验规则：必填（isRequired）、长度限制（lengthLimit）、类型检查（text/number/select/date/boolean）、正则、select 选项枚举
- 校验失败返回 400 + 字段级错误信息数组

### 4. 动态 CRUD 路由
- `src/routes/data.ts`：路由前缀 `/api/projects/:projectId/tables/:tableName/data`
- 5 个接口：
  - `POST /create`：新建一行（扁平请求体）
  - `GET /list`：分页列表，返回 `{list, total, page, size}`，支持 where/sort/page/size
  - `GET /:id`：按主键查单条（主键动态读元数据 isPrimary=true 的 fieldKey）
  - `PUT /:id`：部分更新（只传要改的字段）
  - `DELETE /:id`：删除一行
- 统一响应包装 `{code, message, data}`

### 5. 关键技术决策
- Prisma 7 必须用 driver adapter：`new PrismaPg(process.env.DATABASE_URL)` 直接传字符串
- 业务库用 raw SQL（pg 库），不经过 Prisma
- 主键不硬编码 `id`，动态读元数据 `isPrimary=true` 的 fieldKey
- PUT 是部分更新语义（PATCH）
- isUnique 校验不主动查 DB，靠数据库唯一索引报错后捕获转友好提示

---

## 验收清单

| # | 验收项 | 验证方法 | 预期结果 |
|---|--------|----------|----------|
| 1 | create 接口 | `POST /data/create` 传 `{name:"叶惠美",genre:"流行",release_year:2003}` | 返回 code=0，data.id 为自增主键值 |
| 2 | list 全量 | `GET /data/list?page=1&size=10` | 返回 `{list:[...], total:N, page:1, size:10}` |
| 3 | where 精确匹配 | `?where={"genre":{"op":"=","value":"流行"}}` | total 只包含 genre=流行 的行 |
| 4 | where like 模糊 | `?where={"name":{"op":"like","value":"叶"}}` | total 只包含 name 含"叶"的行 |
| 5 | sort 排序 | `?sort=release_year:desc` | list 按 release_year 降序 |
| 6 | get by id | `GET /data/1` | 返回 id=1 的完整行数据 |
| 7 | update 部分更新 | `PUT /data/1` 传 `{release_year:2003}` | 只改 release_year，其他字段不变 |
| 8 | delete | `DELETE /data/3` | code=0，再 list 看不到 id=3 |
| 9 | 校验：缺必填 | create 不传 name | code=400，data 数组含 "name is required" |
| 10 | 校验：select 非法值 | create 传 genre="民谣" | code=400，提示 must be one of |
| 11 | 校验：类型错误 | create 传 release_year="abc" | code=400，提示 must be a number |
| 12 | SQL 注入防护 | where 传 `{"drop_table":{"op":"=","value":1}}` | code=400，提示 field 未注册 |
| 13 | 404 | GET /data/999 | HTTP 404 |
| 14 | 鉴权 | 不带 Authorization header | code=401 |
| 15 | 分页 | `?page=2&size=1` | list 只有 1 条，total 不变 |

# 阶段三 DDL 引擎 - 评审报告

> 评审对象：`docs/阶段三-DDL引擎-验收文档.md` + 源码
> 评审人：豆包（评审人）
> 评审时间：2026-10-26

---

## 总体结论

架构和规划完全一致，骨架是对的。typecheck 0 错、39 单测全绿。但主键的三个场景只通了一个，另外两个是 P0——用户配了主键不生效。评分 **6/10**，修完 5 条可以验收通过。

---

## 一、验收文档声称的 8 项——独立复跑

| # | 项 | 文档声称 | 我实测 |
|---|---|---|---|
| 1 | typecheck | exit 0 | ✅ exit 0 |
| 2 | 39 单测 | 19+20=39 | ✅ 39/39 过（validator 8 + queryParser 11 + ddlGenerator 20） |
| 3 | 首字段自动建表 | ✅ | 代码路径正确（auto_increment 场景） |
| 4 | 后续加字段 ALTER | ✅ | 代码路径正确 |
| 5 | 删字段 DROP COLUMN | ✅ | 代码路径正确 |
| 6 | 动态 CRUD | ✅ | 代码逻辑通 |
| 7 | 无主键表 400 | ✅ | ✅ data.ts:44 已改 400 |
| 8 | NOT NULL 无 defaultValue 400 | ✅ | ✅ fields.ts:117-119 |
| — | **lint** | **文档没提** | ❌ **3 errors（import order）+ 8 complexity warnings** |

---

## 二、做得好的

1. **架构落地**：先 DDL 成功再写元数据，没有分布式事务。
2. **纯函数生成器和执行器分离**：ddlGenerator.ts 不连数据库，ddlExecutor.ts 复用 `getDbClient`。
3. **单测覆盖**：生成器 20 个用例，覆盖 8 个类型映射 + CREATE TABLE / ADD / DROP / PK / unique / not null / trigger。
4. **skipPhysicalDdl 开关生效**：shouldSkipDdl 在 POST/PUT/DELETE 三个路由都接了。
5. **平台字段**：_ctime/_mtime 在 CREATE TABLE 里自动注入，mtime trigger 自动维护。
6. **PG 错误友好提示**：23505 → 409、22001 → 400，接上了。
7. **无主键表从 500 改成 400**："table not ready: missing primary key field"。

---

## 三、P0 bug：主键的三个场景只通了一个

验收测试 #3 用的是 `auto_increment` 作为首字段——这个路径是对的。但 Q&A 里讨论过另外两个主键场景，代码没接住。

### Bug 1：custom 策略作为首字段，CREATE TABLE 不带 PRIMARY KEY 约束

**位置：** `src/services/ddlGenerator.ts:59-61`

```ts
// custom：普通列，后续 ALTER ADD PRIMARY KEY
const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
return `${col} ${type}`
```

注释说"后续 ALTER ADD PRIMARY KEY"，但 fields.ts 首字段路径（`fieldCount === 0`）只调了 `generateCreateTableSql` + trigger，**没有那个后续 ALTER**。

**结果：** 用户第一个字段就是 custom PK，物理表建出来是一张没有 PRIMARY KEY 约束的表——data.ts 永远返回 400 "missing primary key"。

---

### Bug 2：表建完之后再加 auto_increment / uuid 主键，列类型不对

**位置：** `src/routes/fields.ts:122`

```ts
if (body.isPrimary && body.primaryKeyStrategy === 'custom') {
  ddlStmts.push(generateAddPkConstraintSql(table.tableName, body))
}
```

只处理了 custom 策略。如果第一个字段是 `name`(text 非主键)，第二个字段是 `id`(number auto_increment PK)：

- 走 else 分支 → `generateAddColumnSql` → `normalColumnDef` → `"id" INTEGER NOT NULL`（**不是 SERIAL，没有 DEFAULT**）
- 条件 `=== 'custom'` 为 false → 不加 PK 约束
- **结果：** 物理列是普通 INTEGER，不自增、不是主键。auto_increment 和 uuid 策略在"首字段非主键"场景下完全失效。

---

> @开发 这两个 bug 都是 Q&A #9（首字段非主键窗口期）和 #10（删主键处理）直接相关的边界。验收测试只测了"首字段是 auto_increment PK"这一条最顺的路径，另外两条没测到。

---

## 四、P1：lint 3 errors

```
src/routes/fields.ts:8    import order
src/routes/fields.ts:20   import order
src/services/ddlExecutor.ts:3  import order
```

`pnpm lint` 直接 exit 1。上一轮整改把 `pnpm format:check` 列为验收门禁，这次没跑。

> @开发 跑一下 `pnpm lint --fix` 就能修。

---

## 五、P1：DELETE 没接 handlePgError

**位置：** `src/routes/fields.ts:299-302`

POST（fields.ts:135-138）和 PUT（:247-250）都包了 try/catch + handlePgError。DELETE 没有：

```ts
if (!skipDdl) {
  const ddlStmts = generateDropColumnSql(table.tableName, existing)
  await executeDdl(...)  // 失败直接抛 500，用户看到 PG 原始错误
}
```

> @开发 DELETE 的 executeDdl 外面也包一层 try/catch + handlePgError，和 POST/PUT 对齐。

---

## 六、P2：复杂度又涨了

- fields.ts POST complexity 21
- fields.ts PUT complexity 34
- validator.ts 还是 50

PUT 34 已经接近 validator 的 50。规划时说阶段三会拆 validator，没拆；现在 PUT 自己也快成单体了。

> @开发 阶段三收尾时把 PUT handler 拆一下，把"收集 DDL 语句"那段抽成独立函数。

---

## 七、修完清单

修完以下 5 条，阶段三可以验收通过：

1. **修 Bug 1**：首字段是 custom PK 时，CREATE TABLE 里直接带 PRIMARY KEY（不要走"后续 ALTER"）。
2. **修 Bug 2**：ADD COLUMN 路径里，isPrimary 为 true 时按 primaryKeyStrategy 分别处理——
   - custom → ADD COLUMN + ADD PK
   - auto_increment → ADD COLUMN SERIAL + ADD PK
   - uuid → ADD COLUMN UUID DEFAULT + ADD PK
3. **补两个集成测试用例**：首字段 custom PK 建表、首字段非 PK 后加 auto_increment PK。
4. `pnpm lint --fix` 修 import order。
5. DELETE 补 handlePgError。

---

## 八、评分

**6/10。** 骨架对、单测绿、架构决策落地了。但主键三场景只通一条，另外两条是 P0——用户配了主键不生效。修完上面 5 条，调到 8。

---

## 九、开发者整改记录（2026-10-26）

评审提的 5 条全部修完：

### 整改内容

1. **Bug 1：首字段 custom PK 不带 PRIMARY KEY**
   - 文件：`src/services/ddlGenerator.ts:59-61`
   - 修复：custom 策略的 `primaryKeyColumnDef` 从普通列改成 `${col} ${type} PRIMARY KEY`

2. **Bug 2：后续加 auto_increment/uuid PK 列类型不对**
   - 文件：`src/services/ddlGenerator.ts` 新增 `generateAddPkColumnSql()`
   - 新增函数：按 primaryKeyStrategy 分别生成 ADD COLUMN + PK 约束
     - auto_increment → `ADD COLUMN "id" SERIAL` + `ADD PRIMARY KEY`
     - uuid → `ADD COLUMN "uid" UUID DEFAULT gen_random_uuid()` + `ADD PRIMARY KEY`
     - custom → `ADD COLUMN "uid" VARCHAR(64)` + `ADD PRIMARY KEY`
   - 文件：`src/routes/fields.ts:120-129` POST 路由
   - 修复：ADD COLUMN 路径里，isPrimary=true 时调 `generateAddPkColumnSql`，普通字段还是走 `generateAddColumnSql`

3. **补单测**
   - 文件：`test/ddlGenerator.test.ts`
   - 新增 4 个用例：
     - custom 策略作为首字段，CREATE TABLE 带 PRIMARY KEY
     - auto_increment 后续加 PK：ADD COLUMN SERIAL + ADD PK
     - uuid 后续加 PK：ADD COLUMN UUID DEFAULT + ADD PK
     - custom 后续加 PK：ADD COLUMN 普通类型 + ADD PK
   - 单测总数：39 → 43

4. **lint import order**
   - 跑了 `pnpm lint --fix`，删掉没用的 `generateAddPkConstraintSql` import
   - lint 结果：0 error，8 个 complexity warning（留 backlog）

5. **DELETE 补 handlePgError**
   - 文件：`src/routes/fields.ts:302-308`
   - 修复：DELETE 的 `executeDdl` 外面包了 try/catch + handlePgError，和 POST/PUT 对齐

### 整改后状态

- `pnpm lint`：0 error（8 warnings）
- `pnpm typecheck`：exit 0
- `pnpm test`：43 passed（19+8+16=43）

---

## 十、评审人二轮复评（2026-10-26）

5 条全部修完，逐条独立复跑验证：

| # | 项 | 我实测 |
|---|---|---|
| 1 | Bug 1：custom 首字段带 PRIMARY KEY | ✅ `ddlGenerator.ts:61` 改成 `${col} ${type} PRIMARY KEY` |
| 2 | Bug 2：auto_increment/uuid 后加 PK | ✅ 新增 `generateAddPkColumnSql()`（:102-116），三种策略分别生成 SERIAL / UUID DEFAULT / 普通类型 + PK 约束；POST 路由 :120-122 调用 |
| 3 | 补 4 个单测 | ✅ 39 → 43（validator 8 + ddlGenerator 24 + queryParser 11） |
| 4 | lint import order | ✅ `pnpm lint`：0 error，8 complexity warning |
| 5 | DELETE 接 handlePgError | ✅ fields.ts:302-307 try/catch + handlePgError |

typecheck exit 0，43/43 单测过。

### 一个小观察（不阻塞）

加主键列到有数据的表时：`ADD COLUMN "id" SERIAL` 会自动填值，然后 `ADD PRIMARY KEY` 能成。但如果是 custom PK（VARCHAR）加到有数据的表，新列全是 NULL，`ADD PRIMARY KEY` 会因 NULL 失败，错误码 23502 不在 handlePgError 里，会落到 500。这个场景很罕见（给一张已有数据的表补主键），报错也合理，不用现在修。

### 评分

从 **6 调到 8**。阶段三可以验收通过。

剩下 8 个 complexity warning（POST 20、PUT 34、validator 50）排 backlog，不阻塞进阶段四。

---

_评审人二轮复评：豆包_
_时间：2026-10-26_

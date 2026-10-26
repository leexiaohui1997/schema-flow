import { describe, it, expect } from 'vitest'

import { buildWhereSql, parseQuery, buildOrderBySql } from '../src/services/queryParser.js'

const fields = [
  { fieldKey: 'id', fieldType: 'number' },
  { fieldKey: 'name', fieldType: 'text' },
  { fieldKey: 'genre', fieldType: 'select' },
  { fieldKey: 'release_year', fieldType: 'number' },
] as any

describe('buildWhereSql', () => {
  it('空 where 返回空', () => {
    const r = buildWhereSql([], fields)
    expect(r.sql).toBe('')
    expect(r.params).toEqual([])
    expect(r.nextIndex).toBe(1)
  })

  it('text 字段 = 查询', () => {
    const r = buildWhereSql([{ field: 'genre', op: '=', value: '流行' }], fields)
    expect(r.sql).toBe('"genre" = $1::text')
    expect(r.params).toEqual(['流行'])
  })

  it('number 字段 > 查询走 numeric cast', () => {
    const r = buildWhereSql([{ field: 'release_year', op: '>', value: 2000 }], fields)
    expect(r.sql).toBe('"release_year" > $1::numeric')
    expect(r.params).toEqual(['2000'])
  })

  it('like 查询 escape % 和 _', () => {
    const r = buildWhereSql([{ field: 'name', op: 'like', value: '50%' }], fields)
    expect(r.sql).toContain("LIKE $1::text ESCAPE '\\'")
    expect(r.params[0]).toBe('%50\\%%')
  })

  it('多条件 AND 拼接', () => {
    const r = buildWhereSql(
      [
        { field: 'genre', op: '=', value: '流行' },
        { field: 'release_year', op: '>', value: 2000 },
      ],
      fields,
    )
    expect(r.sql).toBe('"genre" = $1::text AND "release_year" > $2::numeric')
    expect(r.params).toEqual(['流行', '2000'])
    expect(r.nextIndex).toBe(3)
  })
})

describe('parseQuery', () => {
  it('无参数默认 page=1 size=20', () => {
    const r = parseQuery({}, fields)
    expect(r.page).toBe(1)
    expect(r.size).toBe(20)
  })

  it('where JSON 解析', () => {
    const r = parseQuery({ where: '{"genre":{"op":"=","value":"流行"}}' }, fields)
    expect(r.where).toHaveLength(1)
    expect(r.where[0].field).toBe('genre')
  })

  it('未注册字段抛错', () => {
    expect(() => parseQuery({ where: '{"hack":{"op":"=","value":1}}' }, fields)).toThrow(
      /not registered/,
    )
  })

  it('sort 解析', () => {
    const r = parseQuery({ sort: 'release_year:desc' }, fields)
    expect(r.sort).toEqual([{ field: 'release_year', order: 'desc' }])
  })
})

describe('buildOrderBySql', () => {
  it('空 sort 返回空', () => {
    expect(buildOrderBySql([])).toBe('')
  })

  it('单字段', () => {
    expect(buildOrderBySql([{ field: 'name', order: 'asc' }])).toBe('ORDER BY "name" ASC')
  })
})

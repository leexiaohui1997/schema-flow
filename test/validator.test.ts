import { describe, it, expect } from 'vitest'

import { validateData } from '../src/services/validator.js'

const fields = [
  { fieldKey: 'id', fieldType: 'number', isPrimary: true, primaryKeyStrategy: 'auto_increment' },
  { fieldKey: 'name', fieldType: 'text', isRequired: true, lengthLimit: 100 },
  { fieldKey: 'genre', fieldType: 'select', options: ['说唱', '嘻哈', '流行', '摇滚'] },
  { fieldKey: 'release_year', fieldType: 'number' },
  { fieldKey: 'tags', fieldType: 'multiselect', options: ['a', 'b'] },
] as any

describe('validateData', () => {
  it('合法数据无错误', () => {
    const errors = validateData(fields, { name: '测试', genre: '流行' }, true)
    expect(errors).toEqual([])
  })

  it('缺必填', () => {
    const errors = validateData(fields, { genre: '流行' }, true)
    expect(errors[0].field).toBe('name')
  })

  it('select 非法值', () => {
    const errors = validateData(fields, { name: 'x', genre: '民谣' }, true)
    expect(errors[0].field).toBe('genre')
  })

  it('number 传字符串', () => {
    const errors = validateData(fields, { name: 'x', release_year: 'abc' }, false)
    expect(errors[0].field).toBe('release_year')
  })

  it('multiselect 传数组', () => {
    const errors = validateData(fields, { name: 'x', tags: ['a', 'b'] }, false)
    expect(errors).toEqual([])
  })

  it('multiselect 传字符串被拒', () => {
    const errors = validateData(fields, { name: 'x', tags: 'a,b' }, false)
    expect(errors[0].field).toBe('tags')
  })

  it('multiselect 含非法选项', () => {
    const errors = validateData(fields, { name: 'x', tags: ['a', 'c'] }, false)
    expect(errors[0].field).toBe('tags')
  })

  it('auto_increment 主键 create 时不校验必填', () => {
    const errors = validateData(fields, { name: 'x' }, true)
    expect(errors).toEqual([])
  })
})

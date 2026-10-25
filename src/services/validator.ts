// 字段校验引擎：根据元数据校验写入数据
// 只做应用层校验；isUnique 靠 DB 唯一索引，路由层捕获错误后转友好提示

import type { Field } from '@prisma/client'

export interface ValidationError {
  field: string
  message: string
}

/**
 * 校验一行数据（create / update 写入前调用）。
 * @param metaFields 字段元数据列表
 * @param data 用户传入的一行数据
 * @param isCreate true=新建（必填校验生效），false=更新（部分更新，没传的字段不校验）
 * @returns 错误列表，空数组=通过
 */
export function validateData(
  metaFields: Field[],
  data: Record<string, unknown>,
  isCreate: boolean,
): ValidationError[] {
  const errors: ValidationError[] = []
  const dataKeys = new Set(Object.keys(data))

  for (const f of metaFields) {
    const present = dataKeys.has(f.fieldKey)
    const value = data[f.fieldKey]

    // 主键字段：create 时如果是 auto_increment，用户不传是正常的，跳过必填校验
    if (isCreate && f.isPrimary && f.primaryKeyStrategy === 'auto_increment') {
      continue
    }

    // 必填
    if (isCreate && f.isRequired && (value === undefined || value === null || value === '')) {
      errors.push({ field: f.fieldKey, message: `${f.displayName || f.fieldKey} is required` })
      continue
    }

    // 没传就跳过后续校验
    if (!present || value === undefined || value === null) continue

    // 类型校验
    switch (f.fieldType) {
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({
            field: f.fieldKey,
            message: `${f.displayName || f.fieldKey} must be a number`,
          })
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({
            field: f.fieldKey,
            message: `${f.displayName || f.fieldKey} must be a boolean`,
          })
        }
        break
      case 'text':
      case 'richtext':
      case 'password':
      case 'email':
      case 'url':
      case 'select':
        if (typeof value !== 'string') {
          errors.push({
            field: f.fieldKey,
            message: `${f.displayName || f.fieldKey} must be a string`,
          })
        }
        break
      case 'multiselect':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          errors.push({
            field: f.fieldKey,
            message: `${f.displayName || f.fieldKey} must be an array of strings`,
          })
          break
        }
        if (Array.isArray(f.options)) {
          const allowed = (f.options as unknown[]).map(String)
          const invalid = (value as string[]).filter((v) => !allowed.includes(v))
          if (invalid.length > 0) {
            errors.push({
              field: f.fieldKey,
              message: `${f.displayName || f.fieldKey} contains invalid options: ${invalid.join(', ')}`,
            })
          }
        }
        break
    }

    // 长度
    if (typeof value === 'string' && f.lengthLimit && value.length > f.lengthLimit) {
      errors.push({
        field: f.fieldKey,
        message: `${f.displayName || f.fieldKey} exceeds max length ${f.lengthLimit}`,
      })
    }

    // 正则
    if (typeof value === 'string' && f.regex) {
      try {
        if (!new RegExp(f.regex).test(value)) {
          errors.push({
            field: f.fieldKey,
            message: `${f.displayName || f.fieldKey} format invalid`,
          })
        }
      } catch {
        // 元数据里正则本身非法，忽略不阻塞业务
      }
    }

    // select 选项校验
    if (f.fieldType === 'select' && typeof value === 'string' && Array.isArray(f.options)) {
      const allowed = (f.options as unknown[]).map(String)
      if (!allowed.includes(value)) {
        errors.push({
          field: f.fieldKey,
          message: `${f.displayName || f.fieldKey} must be one of: ${allowed.join(', ')}`,
        })
      }
    }
  }

  return errors
}

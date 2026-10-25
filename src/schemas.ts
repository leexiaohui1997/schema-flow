import { z } from 'zod'

export const FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'json',
  'richtext',
  'file',
  'password',
  'email',
  'url',
] as const

export const PRIMARY_KEY_STRATEGIES = ['auto_increment', 'custom', 'uuid'] as const

export const createProjectSchema = z.object({
  name: z.string().min(1).max(128),
  dbType: z.string().min(1).max(32),
  dbConfig: z
    .object({
      host: z.string(),
      port: z.number().int().positive(),
      user: z.string(),
      password: z.string(),
      database: z.string(),
    })
    .passthrough(),
})

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  dbType: z.string().min(1).max(32).optional(),
  dbConfig: z
    .object({
      host: z.string(),
      port: z.number().int().positive(),
      user: z.string(),
      password: z.string(),
      database: z.string(),
    })
    .passthrough()
    .optional(),
  status: z.boolean().optional(),
})

export const createTableSchema = z.object({
  tableName: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'tableName must be snake_case, start with letter, max 64'),
  displayName: z.string().min(1).max(128),
  description: z.string().optional(),
  securityConfig: z.record(z.string(), z.unknown()).optional(),
  viewConfig: z.record(z.string(), z.unknown()).optional(),
})

export const updateTableSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  securityConfig: z.record(z.string(), z.unknown()).optional(),
  viewConfig: z.record(z.string(), z.unknown()).optional(),
  // tableName 创建后只读，这里故意不收
})

export const createFieldSchema = z.object({
  fieldKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'fieldKey must be snake_case, start with letter, max 64'),
  displayName: z.string().min(1).max(128),
  fieldType: z.enum(FIELD_TYPES),
  isPrimary: z.boolean().optional().default(false),
  primaryKeyStrategy: z.enum(PRIMARY_KEY_STRATEGIES).nullable().optional(),
  isRequired: z.boolean().optional().default(false),
  isUnique: z.boolean().optional().default(false),
  isReadonly: z.boolean().optional().default(false),
  lengthLimit: z.number().int().positive().optional(),
  regex: z.string().max(256).optional(),
  defaultValue: z.string().max(256).optional(),
  options: z.array(z.unknown()).optional(),
  sortOrder: z.number().int().optional().default(0),
  extraConfig: z.record(z.string(), z.unknown()).optional(),
})

export const updateFieldSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  fieldType: z.enum(FIELD_TYPES).optional(),
  isPrimary: z.boolean().optional(),
  primaryKeyStrategy: z.enum(PRIMARY_KEY_STRATEGIES).nullable().optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isReadonly: z.boolean().optional(),
  lengthLimit: z.number().int().positive().nullable().optional(),
  regex: z.string().max(256).nullable().optional(),
  defaultValue: z.string().max(256).nullable().optional(),
  options: z.array(z.unknown()).nullable().optional(),
  sortOrder: z.number().int().optional(),
  extraConfig: z.record(z.string(), z.unknown()).optional(),
  // fieldKey 创建后只读
})

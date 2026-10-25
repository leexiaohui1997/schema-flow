// db_config 存取封装
// 阶段一明文读写；未来要加密只改这两个函数，业务代码不动

import type { Prisma } from '@prisma/client'

export interface DbConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  [k: string]: unknown
}

export function serializeDbConfig(cfg: DbConfig): Prisma.InputJsonValue {
  // 阶段一：原样返回，未来在这里加密 password
  return cfg as unknown as Prisma.InputJsonValue
}

export function deserializeDbConfig(raw: Prisma.JsonValue): DbConfig {
  // 阶段一：原样返回，未来在这里解密 password
  return raw as unknown as DbConfig
}

// 统一响应包装 { code, message, data }
// 成功 code=0，失败 code=HTTP 状态码

import { Response } from 'express'

export function ok(res: Response, data: unknown = null, message = 'ok') {
  return res.status(200).json({ code: 0, message, data })
}

export function created(res: Response, data: unknown = null, message = 'created') {
  return res.status(201).json({ code: 0, message, data })
}

export function fail(res: Response, httpStatus: number, message: string, data: unknown = null) {
  return res.status(httpStatus).json({ code: httpStatus, message, data })
}

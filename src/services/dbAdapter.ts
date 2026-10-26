/**
 * 统一 DB 适配器接口
 * 上层代码只面向这个接口，不关心底层是 PG 还是 MySQL
 */
export interface DbAdapter {
  query(sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number }>
  end(): Promise<void>
}

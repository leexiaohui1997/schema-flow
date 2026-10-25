import dotenv from 'dotenv'
dotenv.config()

export const env = {
  port: Number(process.env.PORT ?? 3000),
  adminToken: process.env.ADMIN_TOKEN ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
}

if (!env.adminToken) {
  console.warn('[warn] ADMIN_TOKEN not set, auth middleware will deny all requests')
}

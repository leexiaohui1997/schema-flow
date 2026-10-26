#!/bin/bash
# MySQL 集成测试脚本
# 前提：
# 1. schemaflow-mysql docker 容器已启动
# 2. schemaflow 服务已在 localhost:3000 跑
# 3. 已有一个 MySQL 项目（dbConfig.dbType=mysql）
#
# 用法：
#   TOKEN=xxx PID=proj_xxx TABLE=mysql_test bash scripts/test-mysql-integration.sh

set -e

TOKEN="${TOKEN:?需要 TOKEN}"
PID="${PID:?需要 PID}"
TABLE="${TABLE:-mysql_test}"

BASE="http://localhost:3000/api/projects/$PID/tables/$TABLE/data"

echo "=== 1. CREATE ==="
CREATE_RES=$(curl -s -X POST "$BASE/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"集成测试数据"}')
echo "$CREATE_RES" | python3 -m json.tool
ID=$(echo "$CREATE_RES" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "created id=$ID"

echo "=== 2. LIST ==="
curl -s "$BASE/list?size=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo "=== 3. GET by id ==="
curl -s "$BASE/$ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo "=== 4. PUT update ==="
curl -s -X PUT "$BASE/$ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"更新后的集成测试"}' | python3 -m json.tool

echo "=== 5. WHERE like 查询 ==="
curl -s "$BASE/list?where=%7B%22name%22%3A%7B%22op%22%3A%22like%22%2C%22value%22%3A%22%E6%9B%B4%E6%96%B0%22%7D%7D" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo "=== 6. DELETE ==="
curl -s -X DELETE "$BASE/$ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo "=== 7. 再 LIST 应该空了 ==="
curl -s "$BASE/list?size=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo "=== ✅ MySQL 集成测试完成 ==="

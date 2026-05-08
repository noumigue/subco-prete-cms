#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-./strapi-editorial-data.sql}"

DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-subco-prete-db}"
DB_USER="${DATABASE_USERNAME:-snoumigue}"

{
  cat <<'SQL'
BEGIN;
TRUNCATE TABLE footer_links, candidature_guides, about_pages RESTART IDENTITY CASCADE;
COMMIT;

SQL
  pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --data-only \
    --column-inserts \
    --table=about_pages \
    --table=candidature_guides \
    --table=footer_links
} > "$OUT"

echo "Export éditorial Strapi créé: $OUT"

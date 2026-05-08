#!/usr/bin/env bash
set -euo pipefail

SQL_FILE="${1:-./strapi-editorial-data.sql}"
TARGET_DATABASE_URL="${RENDER_DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "$TARGET_DATABASE_URL" ]]; then
  echo "Erreur: définis RENDER_DATABASE_URL avec l'External Database URL PostgreSQL de Render." >&2
  echo "Exemple: RENDER_DATABASE_URL='postgresql://...' npm run import:editorial" >&2
  exit 1
fi

if [[ ! -f "$SQL_FILE" ]]; then
  echo "Erreur: fichier SQL introuvable: $SQL_FILE" >&2
  exit 1
fi

PGSSLMODE="${PGSSLMODE:-require}" psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 < "$SQL_FILE"

echo "Import éditorial Strapi terminé depuis: $SQL_FILE"

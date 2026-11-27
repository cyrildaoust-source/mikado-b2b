#!/usr/bin/env bash
# Build Vercel : migrations puis construction de l'app.
# Neon fournit DATABASE_URL_UNPOOLED ; Prisma Postgres ou une autre base Vercel
# fournit POSTGRES_URL_NON_POOLING, POSTGRES_URL ou seulement DATABASE_URL.
# Les migrations prennent la première connexion directe disponible.
set -euo pipefail
# Préversion : jamais la base de production. Elle tourne sur la base de test
# reliée avec le préfixe PREVIEW (PREVIEW_URL, PREVIEW_URL_UNPOOLED), en démo.
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  if [ -z "${PREVIEW_URL_UNPOOLED:-}" ] || [ -z "${PREVIEW_URL:-}" ]; then
    echo "Préversion refusée : aucune base de test (préfixe PREVIEW) n'est reliée." >&2
    exit 1
  fi
  export DATABASE_URL="$PREVIEW_URL" DATABASE_URL_UNPOOLED="$PREVIEW_URL_UNPOOLED"
fi
direct="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-${POSTGRES_URL:-${DATABASE_URL:-}}}}"
if [ -z "$direct" ]; then
  echo "Aucune base reliée : ajoutez une base Postgres (Neon ou Prisma Postgres) dans Storage." >&2
  exit 1
fi
export DATABASE_URL_UNPOOLED="$direct"
export DATABASE_URL="${DATABASE_URL:-$direct}"
npx prisma generate
npx prisma migrate deploy
npx react-router build

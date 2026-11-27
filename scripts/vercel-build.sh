#!/usr/bin/env bash
# Build Vercel : migrations puis construction de l'app.
# Neon fournit DATABASE_URL_UNPOOLED ; Prisma Postgres ou une autre base Vercel
# fournit POSTGRES_URL_NON_POOLING, POSTGRES_URL ou seulement DATABASE_URL.
# Les migrations prennent la première connexion directe disponible.
set -euo pipefail
direct="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-${POSTGRES_URL:-${DATABASE_URL:-}}}}"
if [ -z "$direct" ]; then
  echo "Aucune base reliée : ajoutez une base Postgres (Neon ou Prisma Postgres) dans Storage." >&2
  exit 1
fi
export DATABASE_URL_UNPOOLED="$direct"
export DATABASE_URL="${DATABASE_URL:-$direct}"
npx prisma generate
# Les préversions reçoivent la base de production : elles ne la migrent jamais.
# Seul le déploiement de production applique les migrations, après fusion.
if [ "${VERCEL_ENV:-production}" = "production" ]; then
  npx prisma migrate deploy
else
  echo "Préversion (${VERCEL_ENV}) : migrations non appliquées." >&2
fi
npx react-router build

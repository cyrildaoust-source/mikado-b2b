FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev \
    && mkdir -p /data && chown -R node:node /app /data /opt/playwright
ENV NODE_ENV=production PORT=3000 DATABASE_URL=file:/data/mikado.sqlite
USER node
EXPOSE 3000
CMD ["npm", "run", "docker-start"]

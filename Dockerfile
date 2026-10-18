FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY skills ./skills
COPY docs/DECISIONS.md ./docs/DECISIONS.md
COPY ["Tutor Engine — The Shape (v1 spec).md", "./"]
COPY scripts/backup.ts ./scripts/backup.ts
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
ENV TUTOR_HOST=0.0.0.0 TUTOR_PORT=8787 TUTOR_DB=/data/tutor.sqlite TUTOR_UPLOADS=/data/uploads TUTOR_PUBLIC=1 TUTOR_SECURE=1
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "src/start.ts"]

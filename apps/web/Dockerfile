FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/runtime-contract/package.json packages/runtime-contract/package.json

RUN npm ci

COPY apps/web apps/web

RUN npm run build --workspace @postsyncer/web

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@postsyncer/web"]

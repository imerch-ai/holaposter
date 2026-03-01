FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/runtime-contract/package.json packages/runtime-contract/package.json

RUN npm ci

COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src

RUN npm run build --workspace @postsyncer/api

EXPOSE 8080

CMD ["npm", "run", "start", "--workspace", "@postsyncer/api"]

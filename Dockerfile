FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN npm install

COPY . .

RUN npm run prisma:generate --workspace serverokay, i have a server running at 89.167.80.92 - 
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "mkdir -p /app/data && npm run prisma:push --workspace server && npm run start --workspace server"]
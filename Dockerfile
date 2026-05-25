FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ cairo-dev pango-dev

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN mkdir -p uploads

EXPOSE 5000

CMD ["node", "server.js"]

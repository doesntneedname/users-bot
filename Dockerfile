FROM node:20-alpine

WORKDIR /usr/src/app

# Сначала зависимости — слой кешируется, пока не поменялся package.json.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Состояние (очередь приглашений + дедупликация) живёт на volume.
ENV STATE_PATH=/data/state.json
EXPOSE 3002

CMD ["node", "src/index.js"]

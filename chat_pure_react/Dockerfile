FROM node:19-alpine
WORKDIR /front
COPY package.json package-lock.json ./
RUN npm i
COPY . ./
CMD ["npm", "run", "dev"]
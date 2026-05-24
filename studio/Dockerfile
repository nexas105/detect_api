FROM node:22-alpine

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN corepack enable && yarn install --immutable

COPY . .

# NEXT_PUBLIC_* must be present at build time — inlined into the JS bundle
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AUTH_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_URL=$NEXT_PUBLIC_AUTH_URL

RUN yarn build

EXPOSE 3000

CMD ["yarn", "start"]

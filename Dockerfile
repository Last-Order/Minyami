FROM node:22-alpine AS builder

COPY / /Minyami/

WORKDIR /Minyami

RUN npm ci && npm run build && \
    npm pack && \
    mv minyami-`node -p "require('./package.json').version"`.tgz minyami.tgz


FROM node:22-alpine

COPY --from=builder /Minyami/minyami.tgz /minyami.tgz

RUN apk add --no-cache dumb-init mkvtoolnix && \
    npm i -g minyami.tgz

VOLUME /minyami

WORKDIR /minyami

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["minyami", "--help"]

FROM node:alpine AS builder

COPY / /Minyami/

WORKDIR /Minyami

RUN npm i -g typescript && npm ci && tsc && \
    npm pack && \
    find . -type f -name minyami-?.?.?.tgz -exec mv \{} ./minyami.tgz \;


FROM node:alpine

COPY --from=builder /Minyami/minyami.tgz /minyami.tgz

RUN apk add --no-cache dumb-init mkvtoolnix && \
    npm i -g minyami.tgz

VOLUME /minyami

WORKDIR /minyami

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["minyami", "--help"]
FROM node:alpine

ARG VERION="3.0.3"

RUN wget "https://github.com/Last-Order/Minyami/archive/${VERION}.tar.gz" -O "Minyami-${VERION}.tar.gz" && \
	tar -zxf "Minyami-${VERION}.tar.gz" && cd "Minyami-${VERION}" && export npm_config_cache="$(mktemp -d)" && \
	npm install -g typescript && npm install && tsc && rm -r node_modules && \
	npm pack && npm i -g minyami-${VERION}.tgz && \
	npm -g rm typescript && npm clean-install && rm -rf "${npm_config_cache}" && \
	cd .. && rm -rf "Minyami-${VERION}" "Minyami-${VERION}.tar.gz"

VOLUME /minyami

WORKDIR /minyami

ENTRYPOINT ["/usr/local/bin/minyami"]

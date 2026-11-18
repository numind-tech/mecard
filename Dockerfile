# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

ENV NODE_ENV=production
WORKDIR /opt/mecard

# resvg needs a font for cards without a portrait. TLS certificates also
# allow the generator to fetch public photo URLs during a build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# The matching .dockerignore is an allowlist: private data never enters
# the build context, even when this image is built from a working checkout.
COPY *.js *.css LICENSE ./
RUN chmod +x build.js build-site.js \
    && ln -s /opt/mecard/build.js /usr/local/bin/mecard \
    && ln -s /opt/mecard/build-site.js /usr/local/bin/mecard-site \
    && mkdir /work \
    && chown node:node /work

WORKDIR /work
USER node

# GitLab Runner can supply its normal shell script. Local use also supports
# `docker run ... mecard-site ...` or an interactive `sh`.
ENTRYPOINT []
CMD ["sh"]

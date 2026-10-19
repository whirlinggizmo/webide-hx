# webide-hx as an image: the Haxe compiler, the IDE and its libraries built from source in a
# throwaway stage (opam, OCaml, Haxe's libraries, js_of_ocaml: about twenty minutes the
# first time), then only the site in nginx, with the haxelib mirror (hosting/).
#
#     docker build -t webide-hx .
#     docker run -p 8080:80 webide-hx                  then http://localhost:8080/
#     docker run -p 8080:80 -e WEBIDE_PATH=/ide/ ...   served at /ide/ instead
#
# localhost needs no https (browsers treat it as secure, which the IDE's service worker
# needs); for other machines, put it behind a web server with https, as hosting/README.md does.

FROM ubuntu:24.04 AS build
# xdot: opam checks system packages before it installs, and camlp5's build tool
# (not-ocamlfind) lists it. Only this throwaway stage has it, not the image
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential cmake git curl ca-certificates unzip bzip2 m4 pkg-config patch rsync \
        libpcre2-dev zlib1g-dev python3 nodejs npm xdot \
    && rm -rf /var/lib/apt/lists/*
# opam doesn't like running as root
RUN useradd -m builder
USER builder
WORKDIR /home/builder/webide-hx

# the toolchain first, on its own: it's the slow part, and it stays cached until build.py changes
COPY --chown=builder build.py .
RUN python3 build.py --toolchain

# hotreload-hx, for its runtime and the example project the IDE starts with
ARG HOTRELOAD_REF=main
RUN git clone --depth 1 --branch "$HOTRELOAD_REF" https://github.com/whirlinggizmo/hotreload-hx.git /home/builder/hotreload-hx

COPY --chown=builder . .
RUN python3 build.py --hotreload /home/builder/hotreload-hx

FROM nginx:stable
COPY --from=build /home/builder/webide-hx/web /usr/share/nginx/webide-hx
COPY hosting/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV WEBIDE_PATH=/
# the haxelib mirror's cache: keep it in a volume to keep it between containers
VOLUME /var/cache/nginx/haxelib

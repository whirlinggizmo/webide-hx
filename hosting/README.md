# Hosting play.html

play.html is a static page: any file server can serve `web/`. What it can't get from a
static server is haxelib's releases, which haxelib's file server doesn't let web pages read
(HaxeFoundation/haxelib#693 asks for that). Locally, `web/serve.py` relays them. On a server
of your own, a caching mirror on the same site does it: these two files, for an Apache in
front and nginx (in Docker) behind it, as on dev.whirlinggizmo.com. Without either, the page
still builds with libraries pinned to a git commit (lix's `gh:` entries, through jsDelivr)
and with releases added by hand (Project > Add library zip…).

## The mirror (nginx, in the wg-nginx container)

1. Copy `haxelib-mirror.conf.template` into `~/services/nginx/templates/`.
2. Give the cache a volume of its own, so it outlives the container, in
   `~/services/nginx/docker-compose.yml`:

   ```yaml
       volumes:
         # ... as they are, and:
         - haxelib-cache:/var/cache/nginx/haxelib

   volumes:
     haxelib-cache:
   ```

   A named volume, not a directory of the host's: nginx's workers write it as the
   container's `nginx` user, and a named volume starts out theirs.
3. `docker compose up -d` in `~/services/nginx/` (it recreates the container).
4. Check it, on the server:

   ```
   curl -sI "http://127.0.0.1:10080/files/3.0/format-3,7,0.zip" | grep -iE "^HTTP|x-cache"
   ```

   `200` and `X-Cache-Status: MISS` the first time, `HIT` after.

## The site (Apache)

1. Add `apache-haxelib.conf`'s two lines to the page's site's `<VirtualHost *:443>` in
   `/etc/apache2/sites-enabled/000-default-le-ssl.conf`, `PAGE_DIR` replaced by where
   play.html is (`/haxe/` for `https://dev.whirlinggizmo.com/haxe/play.html`).
2. `sudo apachectl configtest && sudo systemctl reload apache2`.
3. Check it, from anywhere:

   ```
   curl -sI "https://dev.whirlinggizmo.com/haxe/haxelib/files/3.0/format-3,7,0.zip" | grep -iE "^HTTP|x-cache|access-control"
   ```

   `200`, and no `Access-Control-Allow-Origin`: only the page's own site reads it.

## The page

`web/` as it is after `build.py` (with `--hotreload`), copied to where `PAGE_DIR` says.

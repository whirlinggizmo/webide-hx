# Hosting webide-hx

play.html is a static page: any file server can serve `web/`, over https (its service
worker runs only on a secure page). What a static server can't give it is haxelib's
releases, which haxelib's file server doesn't let web pages read
(HaxeFoundation/haxelib#693 asks for that). Locally, `web/serve.py` relays them. On a
server of your own, this directory is a service that does both: one nginx container
serving the page and a caching mirror of haxelib's release files, on the same site. Without
it, the page still builds with libraries pinned to a git commit (lix's `gh:` entries,
through jsDelivr) and with releases added by hand (Project > Add library zip…).

- `docker-compose.yml`: the container, on `127.0.0.1:10081` only, with the mirror's cache
  in a volume of its own.
- `nginx.conf.template`: `/webide-hx/` is the page; `/webide-hx/haxelib/files/3.0/` is the
  mirror, which fetches each release once from haxelib-files.haxe.org and keeps it
  (releases never change), rate-limited per visitor, and serves nothing else.
- `deploy.py`: copies those two files and `web/` to the server.

## Putting it on a server (as on dev.whirlinggizmo.com)

1. From here, after `build.py --hotreload ...`:

   ```
   python3 hosting/deploy.py dev:services/webide-hx --up
   ```

   That makes `~/services/webide-hx/` with the compose file, the nginx config and `web/`,
   and starts the container. Deploying again updates it in place; `--up` is only needed
   when the compose file or the nginx config changed.

2. Once, on the server: the site's web server forwards `/webide-hx/` to the container. For
   Apache, in the site's `<VirtualHost *:443>` (on dev.whirlinggizmo.com, the one with
   `ServerName dev.whirlinggizmo.com` in `/etc/apache2/sites-enabled/000-default-le-ssl.conf`):

   ```
   	RedirectMatch 301 ^/webide-hx$ /webide-hx/
   	ProxyPass        /webide-hx/ http://127.0.0.1:10081/webide-hx/
   	ProxyPassReverse /webide-hx/ http://127.0.0.1:10081/webide-hx/
   ```

   then `sudo apachectl configtest && sudo systemctl reload apache2`. (`mod_proxy` and
   `mod_proxy_http` are enabled there already.) The page and the mirror are then one site
   to the browser, so the mirror needs no CORS header, and other sites' pages can't read it.

3. Check it:

   ```
   curl -sI https://dev.whirlinggizmo.com/webide-hx/ | head -1
   curl -sI "https://dev.whirlinggizmo.com/webide-hx/haxelib/files/3.0/format-3,7,0.zip" | grep -iE "^HTTP|x-cache|access-control"
   ```

   `200`; then `200` with `X-Cache-Status: MISS` the first time and `HIT` after, and no
   `Access-Control-Allow-Origin`.

The page is then https://dev.whirlinggizmo.com/webide-hx/ (play.html).

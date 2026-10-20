# Hosting webide-hx

The IDE (`web/index.html`) is a static page: any file server can serve `web/`, over https (its service
worker runs only on a secure page). What a static server can't give it is haxelib's
releases, which haxelib's file server doesn't let web pages read
(HaxeFoundation/haxelib#693 asks for that). Locally, `tools/serve.py` relays them. On a
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
   and starts the container. Deploying again updates it in place; `--up` (which recreates
   the container, a second's gap) is only needed when the compose file or the nginx config
   changed.

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

The IDE is then https://dev.whirlinggizmo.com/webide-hx/.

## The app's own site (run.whirlinggizmos.com)

The app runs best on another site than the IDE (its own process, and none of the IDE's
storage: see the top README's "Where the app runs"). Another site means another
registrable domain: a subdomain of whirlinggizmo.com would still be the IDE's site. It can
be the same machine and the same container, under another name. Without it (both settings
empty), the app runs on the IDE's own origin, as before.

1. DNS: the name points at the server. whirlinggizmos.com's wildcard at no-ip already
   sends `run.whirlinggizmos.com` there.

2. Once, on the server: a site for the name that forwards `/webide-hx/` to the same
   container, and a certificate of its own (a separate one, so a problem renewing it
   can't hold up dev's). In `/etc/apache2/sites-available/run-whirlinggizmos.conf`:

   ```
   <VirtualHost *:80>
   	ServerName run.whirlinggizmos.com
   	RedirectMatch 301 ^/webide-hx$ /webide-hx/
   	ProxyPass        /webide-hx/ http://127.0.0.1:10081/webide-hx/
   	ProxyPassReverse /webide-hx/ http://127.0.0.1:10081/webide-hx/
   </VirtualHost>
   ```

   then

   ```
   sudo a2ensite run-whirlinggizmos && sudo apachectl configtest && sudo systemctl reload apache2
   sudo certbot --apache -d run.whirlinggizmos.com
   ```

   certbot makes the `*:443` copy of the site with the certificate (let it redirect http
   to https).

3. From here: in `hosting/docker-compose.yml`,

   ```
   - WEBIDE_RUNNER=https://run.whirlinggizmos.com/webide-hx/
   - WEBIDE_IDE=https://dev.whirlinggizmo.com
   ```

   and `python3 hosting/deploy.py dev:services/webide-hx --up` (the environment changed).

4. Check it:

   ```
   curl -s https://dev.whirlinggizmo.com/webide-hx/config.json
   curl -sI https://run.whirlinggizmos.com/webide-hx/runner.html | head -1
   ```

   The settings, then `200`. In the IDE, the page test (`?test`) says "the app runs on
   another site than the IDE".

#!/usr/bin/env python3
"""
Puts webide-hx on a server, as a service of its own: the page (web/, as build.py made it,
without test reports) in the service directory's web/, with the service's
docker-compose.yml and nginx.conf.template next to it, by rsync over ssh. With --up, it
then (re)creates the container there, which a changed docker-compose.yml or
nginx.conf.template needs; web/ alone needs nothing more. The directory is the service's own: what's
in its web/ and not in web/ here is removed, so it refuses a directory with other things
in it.

    python3 hosting/deploy.py dev:services/webide-hx [--up]
"""
import os, subprocess, sys

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


def main():
    args = [a for a in sys.argv[1:] if a != "--up"]
    if len(args) != 1 or ":" not in args[0]:
        sys.exit(__doc__)
    host, path = args[0].split(":", 1)
    path = path.rstrip("/")
    if not os.path.exists(os.path.join(WEB, "haxe.js")) or not os.path.exists(os.path.join(WEB, "example", "files.json")):
        sys.exit("web/ isn't built: run build.py (with --hotreload) first")
    # the directory must be new, empty, or already this service's
    check = subprocess.run(["ssh", host, f"mkdir -p '{path}' && cd '{path}' && {{ test -z \"$(ls -A)\" || test -f nginx.conf.template; }}"])
    if check.returncode != 0:
        sys.exit(f"{host}:{path}: it has other things in it: not touching it")
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.run(["rsync", "-az", os.path.join(here, "docker-compose.yml"), os.path.join(here, "nginx.conf.template"), f"{host}:{path}/"], check=True)
    subprocess.run(["rsync", "-az", "--delete", "--exclude", "report*.json",
                    WEB + "/", f"{host}:{path}/web/"], check=True)
    print(f"copied the service and web/ to {host}:{path}")
    if "--up" in sys.argv:
        # recreated, not just started: nginx renders its config from the template only when the
        # container starts, so a changed nginx.conf.template needs a new container
        subprocess.run(["ssh", host, f"cd '{path}' && docker compose up -d --force-recreate"], check=True)


if __name__ == "__main__":
    main()

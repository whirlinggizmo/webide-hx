#!/usr/bin/env python3
"""
Copies play.html and what it needs (web/, as build.py made it) to a server's directory, with
rsync over ssh, leaving out serve.py and test reports. The directory is the page's own:
what's there and not in web/ is removed, so it refuses one that has something in it
but no play.html.

    python3 hosting/deploy.py dev:/var/www/dev.whirlinggizmo.com/haxe/
"""
import os, subprocess, sys

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


def main():
    if len(sys.argv) != 2 or ":" not in sys.argv[1]:
        sys.exit(__doc__)
    target = sys.argv[1].rstrip("/") + "/"
    host, path = target.split(":", 1)
    if not os.path.exists(os.path.join(WEB, "haxe.js")) or not os.path.exists(os.path.join(WEB, "hello", "files.json")):
        sys.exit("web/ isn't built: run build.py (with --hotreload) first")
    # the directory must be empty or already the page's
    check = subprocess.run(["ssh", host, f"test -d '{path}' && {{ test -z \"$(ls -A '{path}')\" || test -f '{path}play.html'; }}"])
    if check.returncode != 0:
        sys.exit(f"{target}: not there, or it has other things in it (no play.html): not touching it")
    subprocess.run(["rsync", "-az", "--delete", "--exclude", "serve.py", "--exclude", "report*.json", "--exclude", "__pycache__",
                    WEB + "/", target], check=True)
    print(f"copied web/ to {target}")


if __name__ == "__main__":
    main()

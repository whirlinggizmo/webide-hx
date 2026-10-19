#!/usr/bin/env python3
"""
Serves this directory (web/) for the pages here, and takes the reports their test modes
POST: the body of any POST is written to the report file.

    python3 serve.py                        http://127.0.0.1:8765/, reports to report.json here
    python3 serve.py 9000                   another port
    python3 serve.py 9000 r.json            another port and report file
    python3 serve.py --tls CERT KEY         https on 8443, on every interface
    TLS_CERT=... TLS_KEY=... python3 serve.py   the same, from the environment

Then open play.html (edit and hot-reload a program) or index.html (the compiler's own
checks).

It also relays haxelib releases for play.html (haxelib's file server doesn't let web pages
read its zips): /haxelib/files/3.0/<name>-<1,2,3>.zip is fetched from haxelib-files.haxe.org
once, kept in build/haxelib-cache, and served from there. Only those files: it isn't a
general proxy. On when the server listens on this machine only; listening on the network
(--tls, or --host), it's off unless --haxelib-relay on.

play.html needs a secure page: its service worker runs only on https, or on http from
localhost/127.0.0.1. So another device on the LAN (a phone, another machine) needs
--tls, with a certificate (PEM) that names this machine's LAN address and that the
device trusts, e.g. one signed by a local development CA (mkcert). With --tls the server
listens on every interface unless --host says otherwise, and prints the LAN address.
"""
import argparse, http.server, os, re, socket, ssl, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HAXELIB_FILES = "https://haxelib-files.haxe.org/files/3.0/"
HAXELIB_CACHE = os.path.join(os.path.dirname(HERE), "build", "haxelib-cache")
# a release's file name: name-1,2,3.zip (a version's dots are commas)
HAXELIB_FILE = re.compile(r"^[A-Za-z0-9_.+-]+-[0-9A-Za-z,+-]+\.zip$")


def lan_address():
    """the address other devices reach this machine at (no packet is sent)"""
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("192.0.2.1", 9))
        address = probe.getsockname()[0]
        probe.close()
        return address
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", type=int, help="the port to serve on (default 8765, or 8443 with TLS)")
    ap.add_argument("report", nargs="?", help="where a page's POSTed report is written (default report.json here)")
    ap.add_argument("--tls", nargs=2, metavar=("CERT", "KEY"),
                    help="serve https with this certificate and key (PEM); or set TLS_CERT and TLS_KEY")
    ap.add_argument("--host", help="the address to listen on (default 127.0.0.1, or every interface with TLS)")
    ap.add_argument("--haxelib-relay", choices=["on", "off"], help="relay haxelib releases at /haxelib/files/3.0/ (default: on when listening on this machine only)")
    args = ap.parse_args()

    cert, key = args.tls if args.tls else (os.environ.get("TLS_CERT"), os.environ.get("TLS_KEY"))
    if (cert is None) != (key is None):
        sys.exit("serve.py: TLS needs both a certificate and a key (--tls CERT KEY, or TLS_CERT and TLS_KEY)")
    tls = cert is not None
    port = args.port or (8443 if tls else 8765)
    host = args.host or ("0.0.0.0" if tls else "127.0.0.1")
    report = os.path.abspath(args.report or os.path.join(HERE, "report.json"))
    relay = args.haxelib_relay == "on" or (args.haxelib_relay is None and host in ("127.0.0.1", "localhost", "::1"))
    os.chdir(HERE)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/haxelib/"):
                return self.haxelib()
            return super().do_GET()

        # a haxelib release, from the cache, or fetched into it first
        def haxelib(self):
            name = self.path[len("/haxelib/files/3.0/"):] if self.path.startswith("/haxelib/files/3.0/") else ""
            if not relay or not HAXELIB_FILE.match(name):
                return self.send_error(404)
            path = os.path.join(HAXELIB_CACHE, name)
            if not os.path.exists(path):
                try:
                    request = urllib.request.Request(HAXELIB_FILES + name, headers={"User-Agent": "haxe-in-browser serve.py"})
                    with urllib.request.urlopen(request, timeout=60) as r:
                        data = r.read()
                except Exception as e:
                    return self.send_error(getattr(e, "code", None) or 502, f"haxelib: {e}")
                os.makedirs(HAXELIB_CACHE, exist_ok=True)
                with open(path + ".part", "wb") as f:
                    f.write(data)
                os.replace(path + ".part", path)
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")  # a release never changes
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            with open(report, "wb") as f:
                f.write(self.rfile.read(n))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass

    try:
        server = http.server.ThreadingHTTPServer((host, port), Handler)
    except OSError as e:
        sys.exit(f"serve.py: can't listen on {host}:{port}: {e.strerror}")
    scheme = "http"
    if tls:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        try:
            context.load_cert_chain(certfile=os.path.expanduser(cert), keyfile=os.path.expanduser(key))
        except (OSError, ssl.SSLError) as e:
            sys.exit(f"serve.py: can't use the certificate {cert} and key {key}: {e}")
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    shown = "localhost" if host in ("0.0.0.0", "127.0.0.1") else host
    print(f"serving {HERE} at {scheme}://{shown}:{port}/play.html (reports to {report}); Ctrl-C to stop", flush=True)
    print(f"  haxelib relay: {'on' if relay else 'off (--haxelib-relay on to relay haxelib releases)'}", flush=True)
    if tls and host == "0.0.0.0":
        address = lan_address()
        if address:
            print(f"  on the LAN: {scheme}://{address}:{port}/play.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

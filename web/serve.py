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

play.html needs a secure page: its service worker runs only on https, or on http from
localhost/127.0.0.1. So another device on the LAN (a phone, another machine) needs
--tls, with a certificate (PEM) that names this machine's LAN address and that the
device trusts, e.g. one signed by a local development CA (mkcert). With --tls the server
listens on every interface unless --host says otherwise, and prints the LAN address.
"""
import argparse, http.server, os, socket, ssl, sys

HERE = os.path.dirname(os.path.abspath(__file__))


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
    args = ap.parse_args()

    cert, key = args.tls if args.tls else (os.environ.get("TLS_CERT"), os.environ.get("TLS_KEY"))
    if (cert is None) != (key is None):
        sys.exit("serve.py: TLS needs both a certificate and a key (--tls CERT KEY, or TLS_CERT and TLS_KEY)")
    tls = cert is not None
    port = args.port or (8443 if tls else 8765)
    host = args.host or ("0.0.0.0" if tls else "127.0.0.1")
    report = os.path.abspath(args.report or os.path.join(HERE, "report.json"))
    os.chdir(HERE)

    class Handler(http.server.SimpleHTTPRequestHandler):
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

#!/usr/bin/env python3
"""
Serves this directory (web/) for the pages here, and takes the reports their test modes
POST: the body of any POST is written to the report file.

    python3 serve.py                 http://127.0.0.1:8765/, reports to report.json here
    python3 serve.py 9000            another port
    python3 serve.py 9000 r.json     another port and report file

Then open play.html (edit and hot-reload a program) or index.html (the compiler's own
checks). The service worker play.html uses needs http://127.0.0.1 or localhost, or https.
"""
import argparse, http.server, os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", type=int, default=8765, help="the port to serve on (default 8765)")
    ap.add_argument("report", nargs="?", help="where a page's POSTed report is written (default report.json here)")
    ap.add_argument("--host", default="127.0.0.1", help="the address to listen on (default 127.0.0.1)")
    args = ap.parse_args()
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

    print(f"serving {HERE} at http://{args.host}:{args.port}/play.html (reports to {report}); Ctrl-C to stop", flush=True)
    try:
        http.server.ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

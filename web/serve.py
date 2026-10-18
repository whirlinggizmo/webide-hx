"""serves the probe page and takes its report: python3 serve.py PORT REPORTFILE"""
import http.server, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
port, report = int(sys.argv[1]), sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        open(report, "wb").write(self.rfile.read(n))
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()

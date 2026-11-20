# Tiny receiver: POST /<name> writes the body to OUT/<name>. Loopback only.
import http.server, os, sys, re
OUT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()
    def do_GET(self):
        body = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'harness.js'), 'rb').read()
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/javascript')
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        name = re.sub(r'[^A-Za-z0-9_.-]', '_', self.path.strip('/')) or 'unnamed'
        n = int(self.headers.get('Content-Length', 0))
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2]) if len(sys.argv) > 2 else 8766), H).serve_forever()

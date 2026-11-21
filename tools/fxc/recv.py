"""Tiny receiver: POST /<name> writes the body to OUT/<name>. Loopback only.

GET /check.html gives the page check.py opens; any other GET gives harness.js.

usage: python -I recv.py <outdir> [port]
"""
import http.server, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def make_server(out, port=8766):
    """A server on 127.0.0.1:<port> (0 picks a free port) that writes posted bodies to the folder `out`."""

    class H(http.server.BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'POST')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()

        def do_GET(self):
            page = self.path.split('?')[0] == '/check.html'
            with open(os.path.join(HERE, 'check.html' if page else 'harness.js'), 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'text/html; charset=utf-8' if page else 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            name = re.sub(r'[^A-Za-z0-9_.-]', '_', self.path.strip('/')) or 'unnamed'
            n = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(n)
            # Write under another name first, so a reader never sees half a file.
            tmp = os.path.join(out, name + '.part')
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, os.path.join(out, name))
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'ok')

        def log_message(self, *a):
            pass

    return http.server.ThreadingHTTPServer(('127.0.0.1', port), H)


if __name__ == '__main__':
    make_server(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8766).serve_forever()

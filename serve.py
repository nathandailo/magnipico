"""Tiny local web server for Magnipico (only needed to run it from this folder instead of a website)."""
import http.server, socketserver, sys, os, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8377
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
                      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
                      '.onnx': 'application/octet-stream', '.css': 'text/css', '.html': 'text/html'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a):
        pass

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

with Server(('127.0.0.1', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}/'
    print('Magnipico is running at', url, '(close this window to stop)', flush=True)
    if '--open' in sys.argv:
        webbrowser.open(url)
    httpd.serve_forever()

"""Local-only static preview. No packages, login or external API required."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import functools
import urllib.request
import urllib.error
import webbrowser

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def do_GET(self):
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4194)
    parser.add_argument('--open', action='store_true', help='Open the default browser')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}/'
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT)))
    except OSError as error:
        if error.errno not in (98, 10048) and getattr(error, 'winerror', None) != 10048:
            raise
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                existing = b'data/source.js' in response.read(100000) and response.status == 200
        except (OSError, urllib.error.URLError):
            existing = False
        if existing:
            print(f'Already running: {url} | A second server was not started.', flush=True)
            if args.open:
                webbrowser.open(url)
            raise SystemExit(0)
        print(f'Port {args.port} is in use. Try: py -3 serve.py --port 4196 --open', flush=True)
        raise SystemExit(1)
    print(f'Open {url} | Stop: Ctrl+C', flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

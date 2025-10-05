from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
import socket


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        # Default to current working directory if not provided
        if directory is None:
            directory = os.getcwd()
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        # Strongly discourage caching for development/preview
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True


def run(host='0.0.0.0', port=8000, directory=None):
    if directory is None:
        directory = os.path.abspath('.')
    handler = lambda *args, **kwargs: NoCacheHandler(*args, directory=directory, **kwargs)
    try:
        httpd = ReusableHTTPServer((host, port), handler)
    except OSError as e:
        print(f"Failed to bind to {host}:{port} -> {e}")
        raise
    print(f"Serving {directory} on http://{host}:{port} (no-cache)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    serve_dir = os.path.abspath(os.environ.get('SERVE_DIR', '.'))
    run(directory=serve_dir)

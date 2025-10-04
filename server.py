from http.server import HTTPServer, SimpleHTTPRequestHandler
import os


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


def run(host='0.0.0.0', port=8000, directory=None):
    if directory is None:
        directory = os.path.abspath('.')
    handler = lambda *args, **kwargs: NoCacheHandler(*args, directory=directory, **kwargs)
    httpd = HTTPServer((host, port), handler)
    print(f"Serving {directory} on http://{host}:{port} (no-cache)")
    httpd.serve_forever()


if __name__ == '__main__':
    serve_dir = os.path.abspath(os.environ.get('SERVE_DIR', '.'))
    run(directory=serve_dir)

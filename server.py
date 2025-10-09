from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
import socket
import argparse


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

    def log_message(self, format, *args):
        # Include Host header to debug forwarded URL issues
        host = self.headers.get('Host', '-') if hasattr(self, 'headers') else '-'
        client = self.address_string()
        try:
            msg = format % args
        except Exception:
            msg = format
        print(f"{client} host={host} :: {msg}")

    def do_GET(self):
        # Simple health check endpoint
        if self.path in ('/__health','/__ping'):
            self.send_response(200)
            self.send_header('Content-Type','text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'OK')
            return
        return super().do_GET()


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
    # If running inside GitHub Codespaces, print the forwarded URL for convenience
    codespace = os.environ.get('CODESPACE_NAME') or os.environ.get('CODESPACES')
    fwd_domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN')
    if codespace and fwd_domain:
        forwarded_url = f"https://{port}-{codespace}.{fwd_domain}"
        print(f"Forwarded URL (Codespaces): {forwarded_url}")
    elif os.environ.get('CODESPACES'):
        # Fallback common domain used by Codespaces
        forwarded_url = f"https://{port}-{os.environ.get('CODESPACES')}.githubpreview.dev"
        print(f"Forwarded URL (Codespaces, default domain): {forwarded_url}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    # Defaults from env vars with sensible fallbacks
    default_host = os.environ.get('HOST', '0.0.0.0')
    # Support common platforms that inject PORT
    default_port_env = os.environ.get('PORT')
    try:
        default_port = int(default_port_env) if default_port_env else 8000
    except ValueError:
        default_port = 8000
    default_dir = os.path.abspath(os.environ.get('SERVE_DIR', '.'))

    parser = argparse.ArgumentParser(description='Lightweight no-cache static server for development.')
    parser.add_argument('--host', default=default_host, help=f'Host interface to bind (default: {default_host})')
    parser.add_argument('--port', type=int, default=default_port, help=f'Port to listen on (default: {default_port})')
    parser.add_argument('--dir', dest='directory', default=default_dir, help=f'Directory to serve (default: {default_dir})')
    args = parser.parse_args()

    run(host=args.host, port=args.port, directory=os.path.abspath(args.directory))

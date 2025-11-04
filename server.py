from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import socket
import argparse
import json
from urllib.parse import urlparse, parse_qs
import time

# Lightweight in-memory store for test reports
_last_test_report = { 'msg': '', 'ts': 0 }


class NoCacheHandler(SimpleHTTPRequestHandler):
    def setup(self):
        # Apply a per-connection timeout so stuck clients don’t hold server threads forever
        try:
            # 30s is generous for large assets while preventing indefinite hangs
            self.request.settimeout(30)
        except Exception:
            pass
        return super().setup()
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
        # Avoid lingering keep-alive connections behind proxies that may timeout
        self.send_header('Connection', 'close')
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

    def _normalize_remote_host(self, host: str):
        """Return (normalized_host, looks_remote) where normalized_host reorders Codespaces/Gitpod
        subdomain to the canonical "8000-<codespace>.<domain>" when applicable. If the host is
        not remote-looking, returns (host, False)."""
        if not host:
            return host, False
        # Strip any :port from Host header for normalization
        try:
            host_no_port = host.split(':', 1)[0]
        except Exception:
            host_no_port = host
        # Treat these as remote forwarded domains
        looks_remote = any(host_no_port.endswith(d) for d in ('app.github.dev', 'githubpreview.dev', 'gitpod.io'))
        if not looks_remote:
            return host_no_port, False
        try:
            parts = host_no_port.split('.')
            sub = parts[0] if parts else ''
            rest = '.'.join(parts[1:]) if len(parts) > 1 else ''
            fixed_port = 8000
            port_suffix = f"-{fixed_port}"
            # Three forms we might see:
            #  1) canonical: 8000-<codespace>
            #  2) reversed:  <codespace>-8000
            #  3) no port:   <codespace>
            if sub.startswith(f"{fixed_port}-"):
                new_sub = sub  # already canonical
            elif sub.endswith(port_suffix):
                base = sub[: -len(port_suffix)] or ''
                new_sub = f"{fixed_port}-{base}" if base else f"{fixed_port}"
            else:
                new_sub = f"{fixed_port}-{sub}" if sub else f"{fixed_port}"
            norm = f"{new_sub}.{rest}" if rest else new_sub
            return norm, True
        except Exception:
            return host_no_port, looks_remote

    def _maybe_redirect_host(self):
        """If the current Host header is a remote forwarded host in a non-canonical form
        (like <codespace>-8000.app.github.dev), issue a 307 redirect to the canonical
        8000-<codespace>.app.github.dev preserving path and query. Returns True if redirected."""
        try:
            host = self.headers.get('Host', '')
            norm_host, looks_remote = self._normalize_remote_host(host)
            if looks_remote and norm_host and norm_host != host:
                # Always redirect to https for remote forwarded hosts
                scheme = 'https'
                location = f"{scheme}://{norm_host}{self.path}"
                self.send_response(307)
                self.send_header('Location', location)
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                return True
        except Exception:
            return False
        return False

    def do_HEAD(self):
        # Normalize/redirect bad forwarded host pattern before handling
        if self._maybe_redirect_host():
            return
        try:
            return super().do_HEAD()
        except (BrokenPipeError, ConnectionResetError):
            # Client went away (often due to proxy timeout); ignore noise
            return

    def do_GET(self):
        # Normalize/redirect bad forwarded host pattern before handling
        if self._maybe_redirect_host():
            return
        # Tiny test reporting endpoints used by in-browser harness
        if self.path.startswith('/__report'):
            try:
                qs = ''
                try:
                    qs = self.path.split('?', 1)[1]
                except Exception:
                    qs = ''
                params = parse_qs(qs)
                msg = params.get('msg', [''])[0]
                global _last_test_report
                _last_test_report = { 'msg': msg, 'ts': int(time.time()*1000) }
                self.send_response(200)
                self.send_header('Content-Type','text/plain; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'OK')
            except Exception:
                self.send_response(500)
                self.send_header('Content-Type','text/plain; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'ERR')
            return
        if self.path == '/__last-test':
            try:
                body = json.dumps(_last_test_report).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type','application/json; charset=utf-8')
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                self.send_response(500)
                self.end_headers()
            return
        # Simple health check endpoint
        if self.path in ('/__health','/__ping'):
            self.send_response(200)
            self.send_header('Content-Type','text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'OK')
            return
        # Forwarded URL helper endpoint: returns JSON with the URL inferred from Host header
        if self.path == '/__forwarded':
            try:
                host = self.headers.get('Host', '')
                # Team policy: advertise 8000 as the forwarded port regardless of bind port
                fixed_port = 8000
                local = f"http://localhost:{fixed_port}"

                # Prefer the forwarded host from the Host header if it looks like a remote domain
                host_no_port = host.split(':', 1)[0] if host else ''
                is_forwarded_host = bool(host_no_port) and not host_no_port.startswith(('0.0.0.0', '127.0.0.1')) and 'localhost' not in host_no_port
                looks_remote = any(host_no_port.endswith(d) for d in ('app.github.dev', 'githubpreview.dev', 'gitpod.io')) if host_no_port else False
                if is_forwarded_host:
                    # Normalize Codespaces/Gitpod host to canonical 8000-<codespace>.<domain>
                    try:
                        if looks_remote:
                            host, _ = self._normalize_remote_host(host)
                    except Exception:
                        pass
                    scheme = 'https' if looks_remote else 'http'
                    url = f"{scheme}://{host}"
                    source = 'host'
                else:
                    # Fall back to environment-derived forwarded URLs (Codespaces/Gitpod)
                    codespace = os.environ.get('CODESPACE_NAME')
                    fwd_domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN') or 'app.github.dev'
                    gitpod_base = os.environ.get('GITPOD_WORKSPACE_URL')
                    url = ''
                    source = 'env'
                    if codespace:
                        # https://8000-<codespace>.<domain>
                        url = f"https://{fixed_port}-{codespace}.{fwd_domain}"
                    elif gitpod_base:
                        try:
                            u = urlparse(gitpod_base)
                            host_only = u.netloc
                            url = f"https://{fixed_port}-{host_only}"
                        except Exception:
                            url = ''
                    # If no env-derived URL, fall back to local
                    if not url:
                        url = local
                        source = 'local'

                resp = {'host': host, 'url': url, 'local': local, 'source': source}
                body = json.dumps(resp).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"error":"failed"}')
            return
        # On first request, print the forwarded URL detected via Host header (if any)
        try:
            global _printed_forwarded_host
            if not _printed_forwarded_host:
                host = self.headers.get('Host') or ''
                host_no_port = host.split(':', 1)[0] if host else ''
                if host_no_port and not host_no_port.startswith('0.0.0.0') and not host_no_port.startswith('127.0.0.1') and 'localhost' not in host_no_port:
                    looks_remote = any(host_no_port.endswith(d) for d in ('app.github.dev', 'githubpreview.dev', 'gitpod.io'))
                    if looks_remote:
                        host_norm, _ = self._normalize_remote_host(host_no_port)
                    else:
                        host_norm = host_no_port
                    scheme = 'https' if looks_remote else 'http'
                    print(f"Detected Forwarded URL: {scheme}://{host_norm}", flush=True)
                    _printed_forwarded_host = True
        except Exception:
            pass
        try:
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            # Client closed connection (e.g., gateway timed out and dropped it)
            return


class ReusableHTTPServer(ThreadingHTTPServer):
    # Threaded server to serve concurrent requests to avoid proxy 504s under burst loads
    allow_reuse_address = True
    daemon_threads = True


def run(host='0.0.0.0', port=8000, directory=None):
    if directory is None:
        directory = os.path.abspath('.')
    handler = lambda *args, **kwargs: NoCacheHandler(*args, directory=directory, **kwargs)
    try:
        httpd = ReusableHTTPServer((host, port), handler)
    except OSError as e:
        print(f"Failed to bind to {host}:{port} -> {e}")
        raise
    print(f"Serving {directory} on http://{host}:{port} (no-cache)", flush=True)
    # Helpful locals
    try:
        print(f"Local URL: http://localhost:{port}", flush=True)
    except Exception:
        pass
    # Print forwarded URL for Codespaces, Gitpod, or give user a hint
    codespace = os.environ.get('CODESPACE_NAME')
    fwd_domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN') or 'app.github.dev'
    if codespace:
        forwarded_url = f"https://{port}-{codespace}.{fwd_domain}"
        print(f"Forwarded URL (Codespaces): {forwarded_url}", flush=True)
    elif os.environ.get('GITPOD_WORKSPACE_URL'):
        # Transform base workspace URL into a port-forwarded URL
        base = os.environ['GITPOD_WORKSPACE_URL']
        try:
            u = urlparse(base)
            host_only = u.netloc
            forwarded_url = f"https://{port}-{host_only}"
            print(f"Forwarded URL (Gitpod): {forwarded_url}", flush=True)
        except Exception:
            print(f"Gitpod base: {base}", flush=True)
    elif os.environ.get('CODESPACES'):
        # Codespaces detected but name not provided; will log detected Host on first request
        print("Codespaces detected; forwarded URL will be printed on first request.", flush=True)
    else:
        # Try to guess forwarded URL for common Codespaces/GitHub/Gitpod patterns
        try:
            # Look for common VS Code remote forwarding envs
            port_str = str(port)
            # Check for github.dev or githubpreview.dev
            for env_var in os.environ:
                if 'GITHUB' in env_var and 'PORT' in env_var and port_str in os.environ[env_var]:
                    print(f"Possible GitHub Codespaces forwarding: {os.environ[env_var]}", flush=True)
            # Print a generic hint
            print("If running in Codespaces or Gitpod, look for a forwarded URL in your IDE Ports panel.", flush=True)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    _printed_forwarded_host = False
    # Defaults from env vars with sensible fallbacks
    default_host = os.environ.get('HOST', '0.0.0.0')
    # Team policy: default to 8000 regardless of PORT env to avoid broken forwarded ports
    default_port = 8000
    default_dir = os.path.abspath(os.environ.get('SERVE_DIR', '.'))

    parser = argparse.ArgumentParser(description='Lightweight no-cache static server for development.')
    parser.add_argument('--host', default=default_host, help=f'Host interface to bind (default: {default_host})')
    parser.add_argument('--port', type=int, default=default_port, help=f'Port to listen on (default: {default_port})')
    parser.add_argument('--dir', dest='directory', default=default_dir, help=f'Directory to serve (default: {default_dir})')
    args = parser.parse_args()

    run(host=args.host, port=args.port, directory=os.path.abspath(args.directory))

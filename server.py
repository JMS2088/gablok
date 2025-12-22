from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import socket
import argparse
import json
from urllib.parse import urlparse, parse_qs
import time
import base64
import tempfile
import subprocess
import shlex
import shutil

try:
    from photoreal import renderer as photoreal_renderer
    _PHOTOREAL_IMPORT_ERROR = None
except Exception as _photoreal_err:
    photoreal_renderer = None  # type: ignore
    _PHOTOREAL_IMPORT_ERROR = _photoreal_err

# Lightweight in-memory store for test reports
_last_test_report = { 'msg': '', 'ts': 0 }
# In-memory admin data: basic user registry and error log
_admin_users = {}
_admin_errors = []
_FORCE_CANONICAL_HOST = str(os.environ.get('FORCE_CANONICAL_HOST', '')).lower() in ('1','true','yes','on')


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Use HTTP/1.1 for better compatibility with some forwarding proxies that
    # may expect keep-alive semantics; we still explicitly send Connection: close.
    protocol_version = 'HTTP/1.1'
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
            # Prefer the bound port if known (set by run()), else PORT env, else 8000
            try:
                fixed_port = int(os.environ.get('GABLOK_BOUND_PORT') or os.environ.get('PORT') or 8000)
            except Exception:
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
        # Allow opting out (default) to avoid redirect loops or interstitials in some environments
        if not _FORCE_CANONICAL_HOST:
            return False
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
        # Serve a tiny in-memory favicon to avoid 404 noise
        if self.path == '/favicon.ico':
            try:
                # 16x16 transparent PNG (1x1 scaled) minimal bytes
                import base64
                png_b64 = (
                    'iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVQ4T2NkwA38z0AGGJgYGEYgQwMDw1EwAQAAc78GgH5BEx8AAAAASUVORK5CYII='
                )
                data = base64.b64decode(png_b64)
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(data)
            except Exception:
                self.send_response(204)
                self.end_headers()
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

        # DWG conversion status endpoint
        if self.path.split('?', 1)[0] == '/api/dwg/status':
            try:
                def _cmd_bins(cmd_tpl: str):
                    try:
                        parts = shlex.split(cmd_tpl)
                    except Exception:
                        try:
                            parts = [p for p in cmd_tpl.split(' ') if p]
                        except Exception:
                            parts = []

                    wrapper = parts[0] if parts else ''
                    converter = ''
                    if wrapper == 'xvfb-run':
                        # Common pattern: xvfb-run -a ODAFileConverter ...
                        if len(parts) >= 3 and parts[1] == '-a':
                            converter = parts[2]
                        elif len(parts) >= 2:
                            converter = parts[1]
                    return {
                        'wrapper': wrapper,
                        'converter': converter,
                    }

                dwg2dxf_tpl = os.environ.get('GABLOK_DWG2DXF_CMD') or os.environ.get('DWG2DXF_CMD') or ''
                dxf2dwg_tpl = os.environ.get('GABLOK_DXF2DWG_CMD') or os.environ.get('DXF2DWG_CMD') or ''

                dwg2dxf_bins = _cmd_bins(dwg2dxf_tpl) if dwg2dxf_tpl else { 'wrapper': '', 'converter': '' }
                dxf2dwg_bins = _cmd_bins(dxf2dwg_tpl) if dxf2dwg_tpl else { 'wrapper': '', 'converter': '' }

                dwg2dxf_bin = dwg2dxf_bins.get('wrapper') or ''
                dxf2dwg_bin = dxf2dwg_bins.get('wrapper') or ''

                body = {
                    'ok': True,
                    'dwgToDxf': {
                        'configured': bool(dwg2dxf_tpl),
                        'env': 'GABLOK_DWG2DXF_CMD',
                        'cmd': dwg2dxf_tpl,
                        'bin': dwg2dxf_bin,
                        'binFound': bool(dwg2dxf_bin and shutil.which(dwg2dxf_bin)),
                        'converterBin': dwg2dxf_bins.get('converter') or '',
                        'converterFound': bool((dwg2dxf_bins.get('converter') or '') and shutil.which(dwg2dxf_bins.get('converter') or ''))
                    },
                    'dxfToDwg': {
                        'configured': bool(dxf2dwg_tpl),
                        'env': 'GABLOK_DXF2DWG_CMD',
                        'cmd': dxf2dwg_tpl,
                        'bin': dxf2dwg_bin,
                        'binFound': bool(dxf2dwg_bin and shutil.which(dxf2dwg_bin)),
                        'converterBin': dxf2dwg_bins.get('converter') or '',
                        'converterFound': bool((dxf2dwg_bins.get('converter') or '') and shutil.which(dxf2dwg_bins.get('converter') or ''))
                    }
                }
                out = json.dumps(body).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(out)
            except Exception as exc:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(json.dumps({ 'ok': False, 'error': 'status-failed', 'message': str(exc) }).encode('utf-8'))
            return
        # Forwarded URL helper endpoint: returns JSON with the URL inferred from Host header
        if self.path == '/__forwarded':
            try:
                host = self.headers.get('Host', '')
                # Advertise the actual bound port when known, else PORT env, else 8000
                try:
                    fixed_port = int(os.environ.get('GABLOK_BOUND_PORT') or os.environ.get('PORT') or 8000)
                except Exception:
                    fixed_port = 8000
                local = f"http://localhost:{fixed_port}"

                # Prefer the forwarded host from the Host header if it looks like a remote domain
                host_no_port = host.split(':', 1)[0] if host else ''
                is_forwarded_host = bool(host_no_port) and not host_no_port.startswith(('0.0.0.0', '127.0.0.1')) and 'localhost' not in host_no_port
                looks_remote = any(host_no_port.endswith(d) for d in ('app.github.dev', 'githubpreview.dev', 'gitpod.io')) if host_no_port else False
                if is_forwarded_host:
                    # Normalize Codespaces/Gitpod host to canonical <port>-<codespace>.<domain>
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
                        # https://<port>-<codespace>.<domain>
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
        # Admin data fetch endpoint
        if self.path == '/__admin-data':
            try:
                users_list = []
                for uid, rec in _admin_users.items():
                    users_list.append({
                        'id': uid,
                        'count': rec.get('count', 1),
                        'lastSeen': rec.get('lastSeen', 0),
                        'ua': rec.get('ua', '')
                    })
                body = json.dumps({ 'users': users_list, 'errors': _admin_errors[-500:] }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type','application/json; charset=utf-8')
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                self.send_response(500)
                self.end_headers()
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

    def _handle_ai_generate(self, data):
        """Proxy AI image generation requests to external APIs."""
        import urllib.request
        import urllib.error
        import ssl
        import base64 as b64_module
        
        provider = data.get('provider', '')
        api_key = data.get('apiKey', '')
        model = data.get('model', '')
        prompt = data.get('prompt', '')
        endpoint = data.get('endpoint', '')
        quality = data.get('quality', {})
        base_image = data.get('baseImage', '')
        
        if not provider or not api_key:
            return {'error': 'Missing provider or API key'}
        
        # Extract base64 data from data URL if present
        base64_image_data = None
        if base_image and base_image.startswith('data:image'):
            if ',' in base_image:
                base64_image_data = base_image.split(',', 1)[1]
            else:
                base64_image_data = base_image
            print(f"[AI Proxy] Base image provided, size: {len(base64_image_data)} bytes")
        
        # Create SSL context - try default first, fall back to unverified
        try:
            ctx = ssl.create_default_context()
        except:
            ctx = ssl._create_unverified_context()
        
        headers = {}
        body = {}
        url = ''
        
        if provider == 'openai':
            # OpenAI supports image editing with DALL-E 2 (not DALL-E 3)
            # For image-to-image, we use the /images/edits endpoint
            if base64_image_data:
                # Use DALL-E 2 for image editing (DALL-E 3 doesn't support edits)
                url = (endpoint or 'https://api.openai.com/v1') + '/images/edits'
                
                # OpenAI requires multipart/form-data for image edits
                import io
                boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
                
                # Decode base64 image to binary
                try:
                    image_binary = b64_module.b64decode(base64_image_data)
                except Exception as e:
                    return {'error': f'Failed to decode base image: {e}'}
                
                # Build multipart form data
                body_parts = []
                body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="render.png"\r\nContent-Type: image/png\r\n\r\n'.encode('utf-8'))
                body_parts.append(image_binary)
                body_parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n{prompt}\r\n'.encode('utf-8'))
                body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ndall-e-2\r\n'.encode('utf-8'))
                body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n'.encode('utf-8'))
                body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n'.encode('utf-8'))
                body_parts.append(f'--{boundary}--\r\n'.encode('utf-8'))
                
                multipart_body = b''.join(body_parts)
                
                headers = {
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': f'multipart/form-data; boundary={boundary}'
                }
                
                try:
                    print(f"[OpenAI] Using image edit endpoint with base image")
                    req = urllib.request.Request(url, data=multipart_body, headers=headers, method='POST')
                    with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
                        resp_data = json.loads(resp.read().decode('utf-8'))
                        images = []
                        for img in resp_data.get('data', []):
                            if img.get('url'):
                                images.append(img['url'])
                            elif img.get('b64_json'):
                                images.append('data:image/png;base64,' + img['b64_json'])
                        return {'images': images, 'provider': provider}
                except urllib.error.HTTPError as e:
                    error_body = e.read().decode('utf-8') if e.fp else ''
                    print(f"[OpenAI] Edit API error ({e.code}): {error_body[:500]}")
                    # Fall back to text-to-image
                    print(f"[OpenAI] Falling back to text-to-image generation")
            
            # Text-to-image (or fallback)
            url = (endpoint or 'https://api.openai.com/v1') + '/images/generations'
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
            size = '1024x1024'
            if quality.get('width', 0) >= 1792:
                size = '1792x1024'
            body = {
                'model': model or 'dall-e-3',
                'prompt': prompt,
                'n': 1,
                'size': size,
                'quality': 'hd' if quality.get('steps', 30) > 35 else 'standard'
            }
        
        elif provider == 'stability':
            import requests as req_lib
            
            model_id = model or 'stable-diffusion-xl-1024-v1-0'
            base_url = (endpoint or 'https://api.stability.ai').rstrip('/')
            
            # Stability AI supports image-to-image with the /image-to-image endpoint
            if base64_image_data:
                print(f"[Stability] Using image-to-image with base render")
                
                # Use multipart/form-data for image-to-image
                try:
                    image_binary = b64_module.b64decode(base64_image_data)
                except Exception as e:
                    return {'error': f'Failed to decode base image: {e}'}
                
                # Stability AI v1 image-to-image endpoint
                url = f"{base_url}/v1/generation/{model_id}/image-to-image"
                
                files = {
                    'init_image': ('render.png', image_binary, 'image/png')
                }
                form_data = {
                    'text_prompts[0][text]': prompt,
                    'text_prompts[0][weight]': '1',
                    'cfg_scale': '7',
                    'image_strength': '0.35',  # How much to preserve original (0.35 = 65% original)
                    'steps': str(quality.get('steps', 30)),
                    'samples': '1'
                }
                
                headers = {
                    'Authorization': f'Bearer {api_key}',
                    'Accept': 'application/json'
                }
                
                try:
                    resp = req_lib.post(url, headers=headers, files=files, data=form_data, timeout=120)
                    print(f"[Stability] Response status: {resp.status_code}")
                    
                    if resp.status_code == 200:
                        resp_data = resp.json()
                        images = []
                        for art in resp_data.get('artifacts', []):
                            if art.get('base64'):
                                images.append('data:image/png;base64,' + art['base64'])
                        return {'images': images, 'provider': provider}
                    else:
                        print(f"[Stability] Image-to-image failed ({resp.status_code}): {resp.text[:500]}")
                        print(f"[Stability] Falling back to text-to-image")
                except Exception as e:
                    print(f"[Stability] Image-to-image error: {e}")
                    print(f"[Stability] Falling back to text-to-image")
            
            # Text-to-image (or fallback)
            url = f"{base_url}/v1/generation/{model_id}/text-to-image"
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
            body = {
                'text_prompts': [{'text': prompt, 'weight': 1}],
                'cfg_scale': 7,
                'height': min(quality.get('height', 1024), 1024),
                'width': min(quality.get('width', 1024), 1024),
                'steps': quality.get('steps', 30),
                'samples': 1
            }
        
        elif provider == 'freepik':
            # Freepik AI Image Generation API
            # Using requests library for better SSL handling
            import requests as req_lib
            
            # Require base image for image-to-image transformation
            if not base64_image_data:
                return {'error': 'Base image is required for Freepik AI enhancement. Please ensure the 3D render is complete.'}
            
            base_url = (endpoint or 'https://api.freepik.com').rstrip('/')
            
            freepik_headers = {
                'x-freepik-api-key': api_key,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
            
            # Build list of endpoints to try
            endpoints_to_try = []
            
            # Use image-to-image endpoint with the provided render
            print(f"[Freepik] Base image provided, using mystic endpoint for image-to-image")
            print(f"[Freepik] Base image data length: {len(base64_image_data)} chars")
            
            # Ensure image has data URI prefix for Freepik
            image_data = base64_image_data
            if not image_data.startswith('data:'):
                image_data = 'data:image/png;base64,' + image_data
            
            # Use mystic endpoint - supports both image reference and prompt
            # The image field accepts a data URI with base64 content
            # Always use widescreen 16:9 for landscape output
            # num_images=1 ensures single generation
            # styling.style controls how much the AI transforms the image
            endpoints_to_try.append(
                (base_url + '/v1/ai/mystic', {
                    'image': {'url': image_data},
                    'prompt': prompt,
                    'aspect_ratio': 'widescreen_16_9',
                    'num_images': 1,
                    'styling': {
                        'style': 'photo',  # Photorealistic style
                        'color': 'pastel', # Natural colors
                        'framing': 'panoramic'  # Wide angle framing
                    }
                })
            )
            
            # Try each endpoint until one works
            last_error = None
            for url, body in endpoints_to_try:
                try:
                    print(f"[Freepik] Trying endpoint: {url}")
                    print(f"[Freepik] Body keys: {list(body.keys())}")
                    
                    resp = req_lib.post(url, json=body, headers=freepik_headers, timeout=120)
                    
                    print(f"[Freepik] Response status: {resp.status_code}")
                    
                    if resp.status_code == 200:
                        resp_data = resp.json()
                        print(f"[Freepik] Success! Response: {str(resp_data)[:500]}")
                        
                        images = []
                        
                        # Check if this is an async task response (mystic endpoint)
                        if resp_data.get('data') and isinstance(resp_data['data'], dict):
                            data_resp = resp_data['data']
                            task_id = data_resp.get('task_id')
                            status = data_resp.get('status')
                            
                            if task_id and status in ['CREATED', 'IN_PROGRESS', 'PENDING']:
                                # Poll for completion
                                print(f"[Freepik] Task created: {task_id}, polling for completion...")
                                import time
                                poll_url = f"{url}/{task_id}"
                                max_attempts = 60  # Max 60 seconds
                                for attempt in range(max_attempts):
                                    time.sleep(1)
                                    poll_resp = req_lib.get(poll_url, headers=freepik_headers, timeout=30)
                                    if poll_resp.status_code == 200:
                                        poll_data = poll_resp.json()
                                        poll_status = poll_data.get('data', {}).get('status')
                                        print(f"[Freepik] Poll attempt {attempt+1}: status={poll_status}")
                                        
                                        if poll_status == 'COMPLETED':
                                            generated = poll_data.get('data', {}).get('generated', [])
                                            for img_url in generated:
                                                if isinstance(img_url, str):
                                                    images.append(img_url)
                                            print(f"[Freepik] Task completed with {len(images)} images")
                                            break
                                        elif poll_status in ['FAILED', 'ERROR']:
                                            print(f"[Freepik] Task failed")
                                            last_error = "Task failed"
                                            break
                                    else:
                                        print(f"[Freepik] Poll failed: {poll_resp.status_code}")
                                
                                if images:
                                    return {'images': images, 'provider': provider}
                                continue
                            
                            # Check for direct image URLs in data
                            if data_resp.get('generated'):
                                for img_url in data_resp['generated']:
                                    if isinstance(img_url, str):
                                        images.append(img_url)
                        
                        # Parse synchronous response (text-to-image returns base64 directly)
                        if not images and resp_data.get('data'):
                            data_resp = resp_data['data']
                            if isinstance(data_resp, list):
                                for img in data_resp:
                                    if isinstance(img, dict):
                                        if img.get('url'):
                                            images.append(img['url'])
                                        elif img.get('base64'):
                                            images.append('data:image/png;base64,' + img['base64'])
                            elif isinstance(data_resp, dict):
                                if data_resp.get('url'):
                                    images.append(data_resp['url'])
                                elif data_resp.get('base64'):
                                    images.append('data:image/png;base64,' + data_resp['base64'])
                        
                        if not images and resp_data.get('images'):
                            for img in resp_data['images']:
                                if isinstance(img, dict) and img.get('url'):
                                    images.append(img['url'])
                                elif isinstance(img, str):
                                    images.append(img)
                        if not images and resp_data.get('image'):
                            images.append(resp_data['image'])
                        if not images and resp_data.get('url'):
                            images.append(resp_data['url'])
                        
                        if images:
                            print(f"[Freepik] Extracted {len(images)} images")
                            return {'images': images, 'provider': provider}
                        else:
                            print(f"[Freepik] No images found in response")
                            last_error = "No images in response"
                            continue
                    else:
                        error_text = resp.text
                        print(f"[Freepik] Endpoint {url} failed ({resp.status_code}): {error_text[:500]}")
                        last_error = f"API error ({resp.status_code}): {error_text[:200]}"
                        continue
                        
                except req_lib.exceptions.SSLError as e:
                    print(f"[Freepik] SSL error for {url}: {e}")
                    last_error = f"SSL error: {str(e)}"
                    continue
                except req_lib.exceptions.ConnectionError as e:
                    print(f"[Freepik] Connection error for {url}: {e}")
                    last_error = f"Connection error: {str(e)}"
                    continue
                except req_lib.exceptions.Timeout as e:
                    print(f"[Freepik] Timeout for {url}: {e}")
                    last_error = f"Timeout: {str(e)}"
                    continue
                except Exception as e:
                    print(f"[Freepik] Exception for {url}: {type(e).__name__}: {e}")
                    last_error = str(e)
                    continue
            
            # All endpoints failed
            return {'error': last_error or 'All Freepik endpoints failed'}
        
        elif provider == 'google':
            # Google Imagen API
            import requests as req_lib
            
            model_id = model or 'imagen-3.0-generate-001'
            base_url = (endpoint or 'https://generativelanguage.googleapis.com/v1beta').rstrip('/')
            
            # Google supports image editing via imageEditMode
            if base64_image_data:
                print(f"[Google] Using image editing with base render")
                
                url = f"{base_url}/models/{model_id}:predict?key={api_key}"
                headers = {'Content-Type': 'application/json'}
                
                body = {
                    'instances': [{
                        'prompt': prompt,
                        'image': {
                            'bytesBase64Encoded': base64_image_data
                        }
                    }],
                    'parameters': {
                        'sampleCount': 1,
                        'editMode': 'inpaint-insert',  # Or 'product-image' for enhancement
                        'aspectRatio': '16:9' if quality.get('width', 0) > quality.get('height', 0) else '1:1'
                    }
                }
                
                try:
                    resp = req_lib.post(url, json=body, headers=headers, timeout=120)
                    print(f"[Google] Response status: {resp.status_code}")
                    
                    if resp.status_code == 200:
                        resp_data = resp.json()
                        images = []
                        for pred in resp_data.get('predictions', []):
                            if pred.get('bytesBase64Encoded'):
                                images.append('data:image/png;base64,' + pred['bytesBase64Encoded'])
                        return {'images': images, 'provider': provider}
                    else:
                        print(f"[Google] Image edit failed ({resp.status_code}): {resp.text[:500]}")
                        print(f"[Google] Falling back to text-to-image")
                except Exception as e:
                    print(f"[Google] Image edit error: {e}")
                    print(f"[Google] Falling back to text-to-image")
            
            # Text-to-image (or fallback)
            url = f"{base_url}/models/{model_id}:predict?key={api_key}"
            headers = {'Content-Type': 'application/json'}
            
            # Enhance prompt for architectural visualization
            enhanced_prompt = prompt
            if base64_image_data:
                enhanced_prompt = f"Photorealistic architectural exterior photo, {prompt}, professional real estate photography, high-end residential architecture"
            
            body = {
                'instances': [{'prompt': enhanced_prompt}],
                'parameters': {
                    'sampleCount': 1,
                    'aspectRatio': '16:9' if quality.get('width', 0) > quality.get('height', 0) else '1:1'
                }
            }
        
        else:
            return {'error': f'Provider {provider} not supported'}
        
        # Make the request
        try:
            req_data = json.dumps(body).encode('utf-8')
            print(f"[AI Proxy] Request to {url}")
            print(f"[AI Proxy] Body: {body}")
            req = urllib.request.Request(url, data=req_data, headers=headers, method='POST')
            
            with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                print(f"[AI Proxy] Response: {resp_data}")
                
                # Normalize response format
                images = []
                
                if provider == 'openai':
                    for img in resp_data.get('data', []):
                        if img.get('url'):
                            images.append(img['url'])
                        elif img.get('b64_json'):
                            images.append('data:image/png;base64,' + img['b64_json'])
                
                elif provider == 'stability':
                    for art in resp_data.get('artifacts', []):
                        if art.get('base64'):
                            images.append('data:image/png;base64,' + art['base64'])
                
                elif provider == 'freepik':
                    # Freepik returns images in various formats depending on endpoint
                    if resp_data.get('data'):
                        data = resp_data['data']
                        # Handle list of images
                        if isinstance(data, list):
                            for img in data:
                                if isinstance(img, dict):
                                    if img.get('url'):
                                        images.append(img['url'])
                                    elif img.get('base64'):
                                        images.append('data:image/png;base64,' + img['base64'])
                                elif isinstance(img, str):
                                    images.append(img)
                        # Handle single image object
                        elif isinstance(data, dict):
                            if data.get('url'):
                                images.append(data['url'])
                            elif data.get('base64'):
                                images.append('data:image/png;base64,' + data['base64'])
                    # Alternative response formats
                    if not images and resp_data.get('images'):
                        for img in resp_data['images']:
                            if isinstance(img, dict) and img.get('url'):
                                images.append(img['url'])
                            elif isinstance(img, str):
                                images.append(img)
                    if not images and resp_data.get('image'):
                        images.append(resp_data['image'])
                    if not images and resp_data.get('url'):
                        images.append(resp_data['url'])
                
                elif provider == 'google':
                    for pred in resp_data.get('predictions', []):
                        if pred.get('bytesBase64Encoded'):
                            images.append('data:image/png;base64,' + pred['bytesBase64Encoded'])
                
                print(f"[AI Proxy] Extracted {len(images)} images")
                return {'images': images, 'provider': provider}
                
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else ''
            try:
                error_json = json.loads(error_body)
                error_msg = error_json.get('error', {}).get('message') or error_json.get('message') or str(error_json)
            except:
                error_msg = error_body or str(e)
            return {'error': f'API error ({e.code}): {error_msg}'}
        except Exception as e:
            return {'error': str(e)}

    def do_POST(self):
        # Normalize/redirect bad forwarded host pattern before handling
        if self._maybe_redirect_host():
            return
        path = self.path.split('?', 1)[0]
        # Read JSON body safely
        length = 0
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except Exception:
            length = 0
        raw = b''
        if length > 0:
            try:
                raw = self.rfile.read(length)
            except Exception:
                raw = b''
        try:
            data = json.loads(raw.decode('utf-8') or '{}') if raw else {}
        except Exception:
            data = {}
        # Handle admin logging endpoints
        if path == '/__log-user':
            try:
                uid = str(data.get('id') or '').strip() or '-'
                ua = str(data.get('ua') or '')
                now = int(time.time() * 1000)
                rec = _admin_users.get(uid) or { 'count': 0, 'lastSeen': 0, 'ua': ua }
                rec['count'] = int(rec.get('count', 0)) + 1
                rec['lastSeen'] = now
                if ua:
                    rec['ua'] = ua
                _admin_users[uid] = rec
                self.send_response(200)
                self.send_header('Content-Type','application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception:
                self.send_response(500)
                self.end_headers()
            return
        if path == '/__log-error':
            try:
                now = int(time.time() * 1000)
                entry = {
                    'ts': now,
                    'userId': str(data.get('id') or ''),
                    'message': str(data.get('message') or ''),
                    'stack': str(data.get('stack') or ''),
                    'meta': data.get('meta') if isinstance(data.get('meta'), dict) else None
                }
                _admin_errors.append(entry)
                # Keep memory bounded
                if len(_admin_errors) > 2000:
                    del _admin_errors[:len(_admin_errors) - 2000]
                self.send_response(200)
                self.send_header('Content-Type','application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception:
                self.send_response(500)
                self.end_headers()
            return
        if path == '/api/photoreal/render':
            if not photoreal_renderer:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                message = 'Photoreal renderer unavailable.'
                if _PHOTOREAL_IMPORT_ERROR:
                    message += f" {_PHOTOREAL_IMPORT_ERROR}"
                self.wfile.write(json.dumps({ 'error': 'photoreal-disabled', 'message': message }).encode('utf-8'))
                return
            try:
                quality = data.get('quality') if isinstance(data, dict) else None
                try:
                    quality_val = float(quality) if quality is not None else 1.0
                except Exception:
                    quality_val = 1.0
                payload = data if isinstance(data, dict) else {}
                job = photoreal_renderer.create_job(payload, quality=quality_val)
                status_code = 200 if job.get('status') != 'failed' else 502
                self.send_response(status_code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(job).encode('utf-8'))
            except Exception as exc:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({ 'error': 'photoreal-render-failed', 'message': str(exc) }).encode('utf-8'))
            return
        
        # AI Image Generation Proxy endpoint
        if path == '/api/ai/generate':
            try:
                result = self._handle_ai_generate(data)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))
            except Exception as exc:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({ 'error': 'ai-generate-failed', 'message': str(exc) }).encode('utf-8'))
            return

        # DWG conversion endpoints (require external converter tool)
        # These endpoints accept JSON with base64 payloads to keep the server lightweight.
        if path == '/api/dwg/to-plan2d':
            def _send_json(status: int, payload: dict):
                try:
                    body = json.dumps(payload).encode('utf-8')
                except Exception:
                    body = b'{"error":"json-encode-failed"}'
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except Exception:
                    pass

            def _iter_dxf_pairs(fp):
                while True:
                    code_line = fp.readline()
                    if not code_line:
                        return
                    val_line = fp.readline()
                    if not val_line:
                        return
                    yield code_line.strip(), val_line.rstrip('\r\n')

            def _parse_float(s: str):
                try:
                    return float(s.strip())
                except Exception:
                    return None

            def _parse_int(s: str):
                try:
                    return int(s.strip())
                except Exception:
                    return None

            def _aci_to_rgb_int(aci: int) -> int:
                # Minimal AutoCAD Color Index mapping for common values.
                # Prefer truecolor (DXF group 420) when present.
                try:
                    a = int(aci)
                except Exception:
                    return 0x111111
                a = abs(a)
                if a == 1:
                    return 0xFF0000
                if a == 2:
                    return 0xFFFF00
                if a == 3:
                    return 0x00FF00
                if a == 4:
                    return 0x00FFFF
                if a == 5:
                    return 0x0000FF
                if a == 6:
                    return 0xFF00FF
                if a == 7:
                    return 0x111111
                return 0x111111

            def _rgb_int_to_hex(rgb: int) -> str:
                try:
                    v = int(rgb) & 0xFFFFFF
                    return '#%06x' % v
                except Exception:
                    return '#111111'

            def _dxf_to_segments(dxf_path: str, max_segments: int, expand_inserts: bool, max_insert_segs: int):
                # Returns (segments, meta)
                from typing import Dict, List, Optional, Tuple
                segs = []
                meta = { 'truncated': False, 'segments': 0, 'blocks': 0, 'insertsExpanded': 0, 'colors': 0 }

                # Layer table colors (name -> rgb int). Used to resolve BYLAYER (ACI 256).
                layer_rgb: Dict[str, int] = {}

                in_entities = False
                in_blocks = False
                in_tables = False
                in_layer_table = False
                current_layer_name: Optional[str] = None
                current_layer_aci: Optional[int] = None
                current_layer_true: Optional[int] = None
                expecting_section_name = False

                blocks = {}
                current_block_name = None
                current_block_base = (0.0, 0.0)
                current_block_segs = None
                current_block_inserts = None
                block_header_active = False

                # Flatten nested INSERTs within blocks (memoized).
                # Produces a list of segments in the block's local coordinate space.
                flattened_blocks: Dict[str, List[Tuple[float, float, float, float, int, Optional[str], Optional[int]]]] = {}

                def _apply_insert_to_segs(
                    base_segs: List[Tuple[float, float, float, float, int, Optional[str], Optional[int]]],
                    ins: dict,
                    out: List[Tuple[float, float, float, float, int, Optional[str], Optional[int]]],
                    *,
                    max_out: int,
                    allow_downsample: bool
                ):
                    try:
                        import math
                        ix_raw = ins.get('x')
                        iy_raw = ins.get('y')
                        if ix_raw is None or iy_raw is None:
                            return
                        ix = float(ix_raw)
                        iy = float(iy_raw)
                        sx = float(ins.get('sx') or 1.0)
                        sy = float(ins.get('sy') or 1.0)
                        if sx == 0.0:
                            sx = 1.0
                        if sy == 0.0:
                            sy = 1.0
                        ang = float(ins.get('rot') or 0.0) * math.pi / 180.0
                        ca = math.cos(ang)
                        sa = math.sin(ang)
                    except Exception:
                        try:
                            ix_raw = ins.get('x')
                            iy_raw = ins.get('y')
                            if ix_raw is None or iy_raw is None:
                                return
                            ix = float(ix_raw)
                            iy = float(iy_raw)
                        except Exception:
                            return
                        sx, sy, ca, sa = 1.0, 1.0, 1.0, 0.0

                    step = 1
                    if allow_downsample and max_insert_segs > 0 and len(base_segs) > max_insert_segs:
                        step = int((len(base_segs) + max_insert_segs - 1) / max_insert_segs)
                        if step < 1:
                            step = 1

                    for i in range(0, len(base_segs), step):
                        if len(out) >= max_out:
                            meta['truncated'] = True
                            break
                        x0, y0, x1, y1, seg_rgb, seg_layer, seg_aci = base_segs[i]

                        # Apply scale
                        x0 *= sx
                        y0 *= sy
                        x1 *= sx
                        y1 *= sy
                        # Apply rotation
                        rx0 = x0 * ca - y0 * sa
                        ry0 = x0 * sa + y0 * ca
                        rx1 = x1 * ca - y1 * sa
                        ry1 = x1 * sa + y1 * ca

                        # BYBLOCK inheritance (rgb==0): inherit this INSERT's visual attrs.
                        if seg_rgb == 0 and (ins.get('rgb') is not None or ins.get('aci') is not None):
                            seg_layer = ins.get('layer')
                            seg_aci = ins.get('aci')
                            seg_rgb = int(_resolve_rgb(seg_layer, seg_aci, ins.get('rgb'))) & 0xFFFFFF

                        out.append((rx0 + ix, ry0 + iy, rx1 + ix, ry1 + iy, int(seg_rgb) & 0xFFFFFF, seg_layer, seg_aci))

                def _flatten_block(name: str, depth: int = 0):
                    if not name:
                        return []
                    if name in flattened_blocks:
                        return flattened_blocks[name]
                    if depth > 8:
                        flattened_blocks[name] = []
                        return []
                    blk = blocks.get(name)
                    if not blk:
                        flattened_blocks[name] = []
                        return []

                    base = list(blk.get('segs') or [])
                    ins_list = blk.get('inserts') or []

                    if not ins_list:
                        flattened_blocks[name] = base
                        return base

                    out = list(base)
                    # Expand nested inserts inside the block.
                    for ins in ins_list:
                        try:
                            child = str(ins.get('name') or '')
                        except Exception:
                            child = ''
                        if not child:
                            continue
                        child_segs = _flatten_block(child, depth + 1)
                        if not child_segs:
                            continue
                        if meta.get('truncated'):
                            break
                        _apply_insert_to_segs(child_segs, ins, out, max_out=max_segments, allow_downsample=False)
                    flattened_blocks[name] = out
                    return out

                cur_type = None
                line_ent: Dict[str, Optional[float]] = { 'x0': None, 'y0': None, 'x1': None, 'y1': None }
                lw = { 'xs': [], 'ys': [], 'flags': 0 }

                # Per-entity visual attributes
                cur_layer: Optional[str] = None
                cur_aci: Optional[int] = None
                cur_rgb: Optional[int] = None
                cur_invisible: bool = False

                poly_active = False
                vertex_active = False
                poly_xs: List[float] = []
                poly_ys: List[float] = []
                poly_flags: int = 0
                vertex: Dict[str, Optional[float]] = { 'x': None, 'y': None }

                insert_active = False
                insert_ent = { 'name': None, 'x': None, 'y': None, 'sx': 1.0, 'sy': 1.0, 'rot': 0.0, 'layer': None, 'aci': None, 'rgb': None }

                def _resolve_rgb(layer: Optional[str], aci: Optional[int], rgb: Optional[int]) -> int:
                    if rgb is not None:
                        try:
                            return int(rgb) & 0xFFFFFF
                        except Exception:
                            return 0x111111
                    if aci is not None:
                        try:
                            ai = int(aci)
                            if ai == 256:
                                # BYLAYER; without reading the LAYER table we can't resolve this perfectly.
                                if layer and layer in layer_rgb:
                                    return int(layer_rgb.get(layer) or 0x111111) & 0xFFFFFF
                                return 0x111111
                            if ai == 0:
                                # BYBLOCK (resolve at INSERT time)
                                return 0
                            return _aci_to_rgb_int(ai)
                        except Exception:
                            return 0x111111
                    return 0x111111

                def _flush_layer_table_record():
                    nonlocal current_layer_name, current_layer_aci, current_layer_true
                    try:
                        name = current_layer_name
                        if not name:
                            return
                        if current_layer_true is not None:
                            layer_rgb[name] = int(current_layer_true) & 0xFFFFFF
                            return
                        if current_layer_aci is not None:
                            ai = abs(int(current_layer_aci))
                            layer_rgb[name] = int(_aci_to_rgb_int(ai)) & 0xFFFFFF
                    except Exception:
                        return
                    finally:
                        current_layer_name = None
                        current_layer_aci = None
                        current_layer_true = None

                def _push_seg(out, x0, y0, x1, y1, *, layer: Optional[str], aci: Optional[int], rgb: Optional[int]):
                    if len(out) >= max_segments:
                        meta['truncated'] = True
                        return
                    if x0 is None or y0 is None or x1 is None or y1 is None:
                        return
                    if not (isinstance(x0, (int, float)) and isinstance(y0, (int, float)) and isinstance(x1, (int, float)) and isinstance(y1, (int, float))):
                        return
                    if not (x0 == x0 and y0 == y0 and x1 == x1 and y1 == y1):
                        return
                    out.append((
                        float(x0),
                        float(y0),
                        float(x1),
                        float(y1),
                        int(_resolve_rgb(layer, aci, rgb)) & 0xFFFFFF,
                        (str(layer) if layer else None),
                        (int(aci) if aci is not None else None)
                    ))

                def _flush_line():
                    if cur_type != 'LINE':
                        return
                    out = current_block_segs if (in_blocks and current_block_segs is not None) else segs
                    if not cur_invisible:
                        _push_seg(out, line_ent['x0'], line_ent['y0'], line_ent['x1'], line_ent['y1'], layer=cur_layer, aci=cur_aci, rgb=cur_rgb)
                    line_ent['x0'] = line_ent['y0'] = line_ent['x1'] = line_ent['y1'] = None

                def _flush_lwpoly():
                    if cur_type != 'LWPOLYLINE':
                        return
                    out = current_block_segs if (in_blocks and current_block_segs is not None) else segs
                    n = min(len(lw['xs']), len(lw['ys']))
                    if n >= 2 and not cur_invisible:
                        for i in range(n - 1):
                            if len(out) >= max_segments:
                                meta['truncated'] = True
                                break
                            _push_seg(out, lw['xs'][i], lw['ys'][i], lw['xs'][i + 1], lw['ys'][i + 1], layer=cur_layer, aci=cur_aci, rgb=cur_rgb)
                        if (lw['flags'] & 1) == 1 and len(out) < max_segments:
                            _push_seg(out, lw['xs'][n - 1], lw['ys'][n - 1], lw['xs'][0], lw['ys'][0], layer=cur_layer, aci=cur_aci, rgb=cur_rgb)
                    lw['xs'].clear()
                    lw['ys'].clear()
                    lw['flags'] = 0

                def _flush_polyline():
                    nonlocal poly_active, vertex_active, poly_flags
                    if not poly_active:
                        return
                    out = current_block_segs if (in_blocks and current_block_segs is not None) else segs
                    n = min(len(poly_xs), len(poly_ys))
                    if n >= 2 and not cur_invisible:
                        for i in range(n - 1):
                            if len(out) >= max_segments:
                                meta['truncated'] = True
                                break
                            _push_seg(out, poly_xs[i], poly_ys[i], poly_xs[i + 1], poly_ys[i + 1], layer=cur_layer, aci=cur_aci, rgb=cur_rgb)
                        if (poly_flags & 1) == 1 and len(out) < max_segments:
                            _push_seg(out, poly_xs[n - 1], poly_ys[n - 1], poly_xs[0], poly_ys[0], layer=cur_layer, aci=cur_aci, rgb=cur_rgb)
                    poly_active = False
                    vertex_active = False
                    poly_xs.clear()
                    poly_ys.clear()
                    poly_flags = 0
                    vertex['x'] = vertex['y'] = None

                def _flush_insert():
                    nonlocal insert_active
                    if not insert_active:
                        return
                    insert_active = False

                    # If we are inside a BLOCK definition, keep the insert for later flattening (nested blocks).
                    if in_blocks and current_block_inserts is not None:
                        current_block_inserts.append(dict(insert_ent))
                        return

                    if not expand_inserts:
                        return
                    name = insert_ent.get('name')
                    if not name:
                        return
                    # Fully flatten nested inserts inside this block for better fidelity.
                    bsegs = _flatten_block(name)
                    if not bsegs:
                        return
                    ix = insert_ent.get('x')
                    iy = insert_ent.get('y')
                    if ix is None or iy is None:
                        return
                    tmp_out: List[Tuple[float, float, float, float, int, Optional[str], Optional[int]]] = []
                    _apply_insert_to_segs(bsegs, insert_ent, tmp_out, max_out=max_segments, allow_downsample=True)
                    for (x0, y0, x1, y1, seg_rgb, seg_layer, seg_aci) in tmp_out:
                        _push_seg(segs, x0, y0, x1, y1, layer=seg_layer, aci=seg_aci, rgb=seg_rgb)
                    meta['insertsExpanded'] = int(meta.get('insertsExpanded') or 0) + 1

                # Read DXF as text; ODA converter outputs ASCII DXF.
                with open(dxf_path, 'r', encoding='utf-8', errors='ignore', newline='') as fp:
                    for code_raw, val_raw in _iter_dxf_pairs(fp):
                        if meta['truncated']:
                            break
                        try:
                            code = int(str(code_raw).strip())
                        except Exception:
                            continue
                        vtrim = str(val_raw).strip()

                        if code == 0:
                            # boundary
                            if cur_type == 'LINE':
                                _flush_line()
                            if cur_type == 'LWPOLYLINE':
                                _flush_lwpoly()
                            if insert_active:
                                _flush_insert()
                            cur_type = None

                            # Reset per-entity attributes
                            cur_layer = None
                            cur_aci = None
                            cur_rgb = None
                            cur_invisible = False

                            if vtrim == 'SECTION':
                                expecting_section_name = True
                                continue
                            if vtrim == 'ENDSEC':
                                in_entities = False
                                in_blocks = False
                                in_tables = False
                                in_layer_table = False
                                _flush_layer_table_record()
                                expecting_section_name = False
                                continue

                            # TABLES parsing (minimal: LAYER colors)
                            if in_tables:
                                if vtrim == 'TABLE':
                                    # Table name arrives as group 2
                                    continue
                                if vtrim == 'ENDTAB':
                                    in_layer_table = False
                                    _flush_layer_table_record()
                                    continue
                                if in_layer_table:
                                    if vtrim == 'LAYER':
                                        _flush_layer_table_record()
                                        current_layer_name = None
                                        current_layer_aci = None
                                        current_layer_true = None
                                    continue

                            if in_blocks:
                                if vtrim == 'BLOCK':
                                    current_block_name = None
                                    current_block_base = (0.0, 0.0)
                                    current_block_segs = []
                                    current_block_inserts = []
                                    block_header_active = True
                                elif vtrim == 'ENDBLK':
                                    if current_block_name and current_block_segs is not None:
                                        bx, by = current_block_base
                                        if (bx != 0.0 or by != 0.0) and current_block_segs:
                                            # normalize relative to base
                                            norm = []
                                            for (x0, y0, x1, y1, rgb, lyr, aci) in current_block_segs:
                                                norm.append((x0 - bx, y0 - by, x1 - bx, y1 - by, rgb, lyr, aci))
                                            current_block_segs = norm
                                        blocks[current_block_name] = { 'base': current_block_base, 'segs': current_block_segs, 'inserts': (current_block_inserts or []) }
                                    current_block_name = None
                                    current_block_segs = None
                                    current_block_base = (0.0, 0.0)
                                    current_block_inserts = None
                                    block_header_active = False

                                # Inside block definitions, parse geometry similarly
                                if vtrim in ('LINE', 'LWPOLYLINE'):
                                    cur_type = vtrim
                                    block_header_active = False
                                elif vtrim == 'POLYLINE':
                                    poly_active = True
                                    poly_xs.clear(); poly_ys.clear(); poly_flags = 0
                                    vertex_active = False
                                    block_header_active = False
                                elif vtrim == 'INSERT':
                                    insert_active = True
                                    insert_ent = { 'name': None, 'x': None, 'y': None, 'sx': 1.0, 'sy': 1.0, 'rot': 0.0, 'layer': None, 'aci': None, 'rgb': None }
                                    block_header_active = False
                                elif vtrim == 'VERTEX':
                                    if poly_active:
                                        vertex_active = True
                                        vertex['x'] = None
                                        vertex['y'] = None
                                    block_header_active = False
                                elif vtrim == 'SEQEND':
                                    _flush_polyline()

                            if in_entities:
                                if vtrim == 'POLYLINE':
                                    poly_active = True
                                    poly_xs.clear(); poly_ys.clear(); poly_flags = 0
                                    vertex_active = False
                                elif vtrim == 'VERTEX':
                                    if poly_active:
                                        vertex_active = True
                                        vertex['x'] = None
                                        vertex['y'] = None
                                elif vtrim == 'SEQEND':
                                    _flush_polyline()

                                if vtrim in ('LINE', 'LWPOLYLINE'):
                                    cur_type = vtrim
                                elif vtrim == 'INSERT':
                                    insert_active = True
                                    insert_ent = { 'name': None, 'x': None, 'y': None, 'sx': 1.0, 'sy': 1.0, 'rot': 0.0, 'layer': None, 'aci': None, 'rgb': None }
                                else:
                                    cur_type = None

                            continue

                        if expecting_section_name:
                            if code == 2:
                                in_entities = (vtrim == 'ENTITIES')
                                in_blocks = (vtrim == 'BLOCKS')
                                in_tables = (vtrim == 'TABLES')
                                in_layer_table = False
                                _flush_layer_table_record()
                                expecting_section_name = False
                            continue

                        # Parse layer table content when inside TABLES
                        if in_tables:
                            # Table name selection
                            if code == 2 and vtrim == 'LAYER':
                                in_layer_table = True
                                _flush_layer_table_record()
                                continue
                            if not in_layer_table:
                                continue
                            # Within a LAYER record
                            if code == 2:
                                current_layer_name = vtrim
                                continue
                            if code == 62:
                                current_layer_aci = _parse_int(vtrim)
                                continue
                            if code == 420:
                                current_layer_true = _parse_int(vtrim)
                                continue
                            continue

                        # Block header metadata (ONLY in the BLOCK header record).
                        # IMPORTANT: do NOT consume entity coordinate codes (10/20) inside blocks.
                        if in_blocks and current_block_segs is not None and block_header_active:
                            if current_block_name is None and code == 2:
                                current_block_name = vtrim
                                continue
                            if code == 10:
                                x = _parse_float(vtrim)
                                if x is not None:
                                    current_block_base = (x, current_block_base[1])
                                continue
                            if code == 20:
                                y = _parse_float(vtrim)
                                if y is not None:
                                    current_block_base = (current_block_base[0], y)
                                continue

                        if not in_entities and not in_blocks:
                            continue

                        # Common DXF entity attributes
                        if code == 8:
                            cur_layer = vtrim
                            if insert_active:
                                insert_ent['layer'] = vtrim
                            continue
                        if code == 62:
                            cur_aci = _parse_int(vtrim)
                            try:
                                if cur_aci is not None and int(cur_aci) < 0:
                                    cur_invisible = True
                            except Exception:
                                pass
                            if insert_active:
                                insert_ent['aci'] = cur_aci
                            continue
                        if code == 420:
                            cur_rgb = _parse_int(vtrim)
                            if insert_active:
                                insert_ent['rgb'] = cur_rgb
                            continue

                        if cur_type == 'LINE':
                            if code == 10:
                                line_ent['x0'] = _parse_float(vtrim)
                            elif code == 20:
                                line_ent['y0'] = _parse_float(vtrim)
                            elif code == 11:
                                line_ent['x1'] = _parse_float(vtrim)
                            elif code == 21:
                                line_ent['y1'] = _parse_float(vtrim)
                            continue

                        if cur_type == 'LWPOLYLINE':
                            if code == 10:
                                x = _parse_float(vtrim)
                                if x is not None:
                                    lw['xs'].append(x)
                            elif code == 20:
                                y = _parse_float(vtrim)
                                if y is not None:
                                    lw['ys'].append(y)
                            elif code == 70:
                                n = _parse_int(vtrim)
                                lw['flags'] = n or 0
                            continue

                        if insert_active:
                            if code == 2:
                                insert_ent['name'] = vtrim
                            elif code == 10:
                                insert_ent['x'] = _parse_float(vtrim)
                            elif code == 20:
                                insert_ent['y'] = _parse_float(vtrim)
                            elif code == 41:
                                insert_ent['sx'] = _parse_float(vtrim) or 1.0
                            elif code == 42:
                                insert_ent['sy'] = _parse_float(vtrim) or 1.0
                            elif code == 50:
                                insert_ent['rot'] = _parse_float(vtrim) or 0.0
                            continue

                        if poly_active:
                            if not vertex_active:
                                if code == 70:
                                    poly_flags = _parse_int(vtrim) or 0
                            else:
                                if code == 10:
                                    vertex['x'] = _parse_float(vtrim)
                                elif code == 20:
                                    vertex['y'] = _parse_float(vtrim)
                                vx = vertex.get('x')
                                vy = vertex.get('y')
                                if vx is not None and vy is not None:
                                    # poly_xs/poly_ys are lists of floats
                                    poly_xs.append(float(vx))
                                    poly_ys.append(float(vy))
                                    vertex['x'] = None
                                    vertex['y'] = None

                # trailing flush
                if cur_type == 'LINE':
                    _flush_line()
                if cur_type == 'LWPOLYLINE':
                    _flush_lwpoly()
                if insert_active:
                    _flush_insert()
                if poly_active:
                    _flush_polyline()

                meta['segments'] = len(segs)
                meta['blocks'] = len(blocks)
                try:
                    meta['colors'] = len({ int(s[4]) for s in segs if len(s) >= 5 })
                except Exception:
                    meta['colors'] = 0
                return segs, meta

            def _simplify_to_plan2d_elements(segs, *, units: str, max_walls: int, min_len_mm: float, quant_mm: float, thickness_m: float, level: int):
                import math
                scale_to_m = 0.001 if units == 'mm' else 1.0
                q = float(quant_mm) if quant_mm and quant_mm > 0 else 10.0
                min_len2 = float(min_len_mm) * float(min_len_mm)

                def _qv(v: float) -> float:
                    return round(v / q) * q

                # Dedup on quantized integer-ish coords
                seen = set()
                cand = []  # tuples: (len2, x0,y0,x1,y1) in mm
                for s in segs:
                    try:
                        x0, y0, x1, y1 = float(s[0]), float(s[1]), float(s[2]), float(s[3])
                    except Exception:
                        continue
                    x0q = _qv(x0)
                    y0q = _qv(y0)
                    x1q = _qv(x1)
                    y1q = _qv(y1)
                    dx = x1q - x0q
                    dy = y1q - y0q
                    l2 = dx * dx + dy * dy
                    if not (l2 == l2) or l2 < min_len2:
                        continue
                    ax0, ay0, ax1, ay1 = x0q, y0q, x1q, y1q
                    if ax0 > ax1 or (ax0 == ax1 and ay0 > ay1):
                        ax0, ax1 = ax1, ax0
                        ay0, ay1 = ay1, ay0
                    # Keep colors distinct in the dedupe key when present.
                    rgb_key = None
                    try:
                        rgb_key = int(s[4]) if len(s) >= 5 and s[4] is not None else None
                    except Exception:
                        rgb_key = None
                    key = (int(round(ax0)), int(round(ay0)), int(round(ax1)), int(round(ay1)), rgb_key)
                    if key in seen:
                        continue
                    seen.add(key)
                    cand.append((l2, x0q, y0q, x1q, y1q))

                # Keep longest N
                if max_walls and len(cand) > max_walls:
                    import heapq
                    heap = []
                    for rec in cand:
                        l2 = rec[0]
                        if len(heap) < max_walls:
                            heapq.heappush(heap, rec)
                        else:
                            if l2 > heap[0][0]:
                                heapq.heapreplace(heap, rec)
                    cand = heap

                elements = []
                for (_l2, x0q, y0q, x1q, y1q) in cand:
                    elements.append({
                        'type': 'wall',
                        'x0': float(x0q) * scale_to_m,
                        'y0': float(y0q) * scale_to_m,
                        'x1': float(x1q) * scale_to_m,
                        'y1': float(y1q) * scale_to_m,
                        'thickness': float(thickness_m),
                        'level': int(level),
                        'manual': True
                    })
                return elements, { 'scaleToM': scale_to_m, 'quantMm': q, 'minLenMm': float(min_len_mm), 'dedup': len(seen) }

            def _segments_to_plan2d_cad_elements(segs, *, units: str, thickness_m: float, level: int, weld_mm: float):
                # 1:1 “CAD linework” import. Keeps all segments and their colors.
                scale_to_m = 0.001 if units == 'mm' else 1.0
                weld = float(weld_mm) if weld_mm and weld_mm > 0 else 0.0
                elements = []
                color_counts = {}
                layer_counts = {}
                # Dedup after optional weld (snap). Keeps colors distinct.
                seen = set()

                # Endpoint welding via neighborhood snapping (better than rounding).
                # Uses a grid hash of size `weld` and snaps endpoints within radius.
                point_cells = {}
                def _snap_pt(x: float, y: float):
                    if weld <= 0:
                        return x, y
                    try:
                        import math
                        cx = int(math.floor(x / weld))
                        cy = int(math.floor(y / weld))
                        best = None
                        best_d2 = weld * weld
                        for ox in (-1, 0, 1):
                            for oy in (-1, 0, 1):
                                key = (cx + ox, cy + oy)
                                pts = point_cells.get(key)
                                if not pts:
                                    continue
                                for (px, py) in pts:
                                    dx = x - px
                                    dy = y - py
                                    d2 = dx * dx + dy * dy
                                    if d2 <= best_d2:
                                        best_d2 = d2
                                        best = (px, py)
                        if best is not None:
                            return best[0], best[1]
                        # New canonical point
                        point_cells.setdefault((cx, cy), []).append((x, y))
                        return x, y
                    except Exception:
                        return x, y

                for s in segs:
                    try:
                        x0, y0, x1, y1 = float(s[0]), float(s[1]), float(s[2]), float(s[3])
                    except Exception:
                        continue

                    if weld > 0:
                        x0, y0 = _snap_pt(x0, y0)
                        x1, y1 = _snap_pt(x1, y1)

                    try:
                        rgb = int(s[4]) if len(s) >= 5 and s[4] is not None else 0x111111
                    except Exception:
                        rgb = 0x111111
                    rgb = rgb & 0xFFFFFF

                    # Dedup (order-invariant) after weld.
                    try:
                        ax0, ay0, ax1, ay1 = x0, y0, x1, y1
                        if ax0 > ax1 or (ax0 == ax1 and ay0 > ay1):
                            ax0, ax1 = ax1, ax0
                            ay0, ay1 = ay1, ay0
                        key = (round(ax0, 6), round(ay0, 6), round(ax1, 6), round(ay1, 6), int(rgb))
                        if key in seen:
                            continue
                        seen.add(key)
                    except Exception:
                        pass

                    stroke = _rgb_int_to_hex(rgb)
                    color_counts[stroke] = int(color_counts.get(stroke) or 0) + 1

                    layer = None
                    try:
                        layer = str(s[5]) if len(s) >= 6 and s[5] else None
                    except Exception:
                        layer = None
                    if layer:
                        layer_counts[layer] = int(layer_counts.get(layer) or 0) + 1

                    elements.append({
                        'type': 'wall',
                        'x0': x0 * scale_to_m,
                        'y0': y0 * scale_to_m,
                        'x1': x1 * scale_to_m,
                        'y1': y1 * scale_to_m,
                        # thickness is used for hit-testing; rendering is hairline for CAD elements.
                        'thickness': float(thickness_m),
                        'level': int(level or 0),
                        'wallRole': 'nonroom',
                        'manual': True,
                        'meta': {
                            'cad': True,
                            'stroke': stroke,
                            'layer': layer,
                            'rgb': rgb
                        }
                    })

                colors_top = []
                try:
                    colors_top = sorted(color_counts.items(), key=lambda kv: kv[1], reverse=True)[:40]
                except Exception:
                    colors_top = list(color_counts.items())[:40]
                layers_top = []
                try:
                    layers_top = sorted(layer_counts.items(), key=lambda kv: kv[1], reverse=True)[:40]
                except Exception:
                    layers_top = list(layer_counts.items())[:40]

                return elements, {
                    'scaleToM': scale_to_m,
                    'elements': len(elements),
                    'weldMm': weld,
                    'colorsTop': colors_top,
                    'layersTop': layers_top
                }

            try:
                if not isinstance(data, dict):
                    return _send_json(400, { 'error': 'bad-request', 'message': 'Expected JSON object body.' })

                cmd_key = 'GABLOK_DWG2DXF_CMD'
                cmd_tpl = os.environ.get(cmd_key) or os.environ.get('DWG2DXF_CMD')
                if not cmd_tpl:
                    return _send_json(501, {
                        'error': 'dwg-converter-not-configured',
                        'message': f"{cmd_key} is not set on the server. Install/configure a DWG converter CLI and set this env var.",
                        'requiredEnv': cmd_key
                    })

                filename = str(data.get('filename') or '').strip() or 'input.dwg'
                b64 = data.get('bytesBase64') or data.get('dwgBase64')
                if not isinstance(b64, str) or not b64:
                    return _send_json(400, { 'error': 'bad-request', 'message': 'Missing bytesBase64 (or dwgBase64) for DWG input.' })
                try:
                    raw_in = base64.b64decode(b64, validate=False)
                except Exception as exc:
                    return _send_json(400, { 'error': 'bad-request', 'message': 'Invalid base64 payload.', 'detail': str(exc) })

                # Options tuned for "simple line" imports.
                qs = parse_qs(urlparse(self.path).query)

                mode = str(data.get('mode') or (qs.get('mode', ['cad'])[0] if qs else 'cad')).strip().lower()
                if mode not in ('cad', 'simplified'):
                    mode = 'cad'
                units = str(data.get('units') or (qs.get('units', ['mm'])[0] if qs else 'mm')).lower()
                if units not in ('mm', 'm'):
                    units = 'mm'
                max_walls = int(data.get('maxWalls') or (qs.get('maxWalls', ['250000' if mode == 'cad' else '12000'])[0] if qs else ('250000' if mode == 'cad' else '12000')))
                if max_walls <= 0:
                    max_walls = 250000 if mode == 'cad' else 12000
                min_len_mm = float(data.get('minLenMm') or (qs.get('minLenMm', ['0' if mode == 'cad' else '100'])[0] if qs else ('0' if mode == 'cad' else '100')))
                if min_len_mm < 0:
                    min_len_mm = 0.0
                quant_mm = float(data.get('quantMm') or (qs.get('quantMm', ['0' if mode == 'cad' else '20'])[0] if qs else ('0' if mode == 'cad' else '20')))
                if quant_mm < 0:
                    quant_mm = 0.0
                # CAD drawings are hairline strokes; thickness here is for selection/hit-test.
                thickness_m = float(data.get('thicknessM') or (0.02 if mode == 'cad' else 0.01))
                level = int(data.get('level') or 0)

                # Optional weld/snapping for CAD mode so endpoints align (in input units, mm preferred).
                weld_mm = float(data.get('weldMm') or (1.0 if mode == 'cad' else 0.0))
                if weld_mm < 0:
                    weld_mm = 0.0

                # Segment parsing caps
                max_segments = int(data.get('maxSegments') or (qs.get('maxSegments', ['750000' if mode == 'cad' else '300000'])[0] if qs else ('750000' if mode == 'cad' else '300000')))
                if max_segments <= 0:
                    max_segments = 750000 if mode == 'cad' else 300000
                expand_inserts = bool(data.get('expandInserts') if 'expandInserts' in data else True)
                max_insert_segs = int(data.get('maxInsertSegs') or (qs.get('maxInsertSegs', ['20000' if mode == 'cad' else '2500'])[0] if qs else ('20000' if mode == 'cad' else '2500')))
                if max_insert_segs <= 0:
                    max_insert_segs = 20000 if mode == 'cad' else 2500

                with tempfile.TemporaryDirectory(prefix='gablok-dwg-') as td:
                    in_dir = os.path.join(td, 'in')
                    out_dir = os.path.join(td, 'out')
                    os.makedirs(in_dir, exist_ok=True)
                    os.makedirs(out_dir, exist_ok=True)

                    in_path = os.path.join(in_dir, filename)
                    out_path = os.path.join(out_dir, 'out.dxf')
                    with open(in_path, 'wb') as f:
                        f.write(raw_in)

                    expanded = (cmd_tpl
                                .replace('{in}', in_path)
                                .replace('{out}', out_path)
                                .replace('{in_dir}', in_dir)
                                .replace('{out_dir}', out_dir))
                    try:
                        args = shlex.split(expanded)
                    except Exception:
                        args = expanded.split(' ')
                    if not args or not args[0]:
                        return _send_json(500, { 'error': 'converter-misconfigured', 'message': f"{cmd_key} is empty after expansion." })

                    try:
                        proc = subprocess.run(
                            args,
                            cwd=td,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            timeout=300
                        )
                    except FileNotFoundError:
                        return _send_json(501, { 'error': 'converter-not-found', 'message': f"Converter binary not found for {cmd_key}.", 'cmd': args[0] })
                    except subprocess.TimeoutExpired:
                        return _send_json(504, { 'error': 'converter-timeout', 'message': 'Conversion timed out.' })
                    except Exception as exc:
                        return _send_json(500, { 'error': 'converter-failed', 'message': 'Conversion failed to execute.', 'detail': str(exc) })

                    if proc.returncode != 0:
                        return _send_json(502, {
                            'error': 'converter-error',
                            'message': 'Converter returned non-zero exit code.',
                            'code': int(proc.returncode),
                            'stdout': (proc.stdout or b'')[:2000].decode('utf-8', errors='replace'),
                            'stderr': (proc.stderr or b'')[:4000].decode('utf-8', errors='replace')
                        })

                    if not os.path.exists(out_path):
                        found = None
                        try:
                            for name in os.listdir(out_dir):
                                if name.lower().endswith('.dxf'):
                                    found = os.path.join(out_dir, name)
                                    break
                        except Exception:
                            found = None
                        if not found or not os.path.exists(found):
                            return _send_json(502, {
                                'error': 'no-output',
                                'message': 'Converter produced no output file.',
                                'stdout': (proc.stdout or b'')[:2000].decode('utf-8', errors='replace'),
                                'stderr': (proc.stderr or b'')[:4000].decode('utf-8', errors='replace')
                            })
                        out_path = found

                    segs, parse_meta = _dxf_to_segments(out_path, max_segments=max_segments, expand_inserts=expand_inserts, max_insert_segs=max_insert_segs)
                    if mode == 'cad':
                        elements, simp_meta = _segments_to_plan2d_cad_elements(
                            segs,
                            units=units,
                            thickness_m=thickness_m,
                            level=level,
                            weld_mm=weld_mm
                        )
                    else:
                        elements, simp_meta = _simplify_to_plan2d_elements(
                            segs,
                            units=units,
                            max_walls=max_walls,
                            min_len_mm=min_len_mm,
                            quant_mm=quant_mm,
                            thickness_m=thickness_m,
                            level=level
                        )

                    return _send_json(200, {
                        'ok': True,
                        'format': 'gablok-2d-plan',
                        'elements': elements,
                        'meta': {
                            'source': 'dwg',
                            'units': units,
                            'mode': mode,
                            'parse': parse_meta,
                            'simplify': simp_meta,
                            'generatedAt': int(time.time() * 1000)
                        }
                    })
            except Exception as exc:
                return _send_json(500, { 'error': 'dwg-to-plan2d-failed', 'message': str(exc) })

            return

        if path in ('/api/dwg/to-dxf', '/api/dwg/to-dwg'):
            def _send_json(status: int, payload: dict):
                try:
                    body = json.dumps(payload).encode('utf-8')
                except Exception:
                    body = b'{"error":"json-encode-failed"}'
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except Exception:
                    pass

            try:
                if not isinstance(data, dict):
                    return _send_json(400, { 'error': 'bad-request', 'message': 'Expected JSON object body.' })

                # Allow configuring command templates using placeholders: {in} {out}
                # Example:
                #  - export GABLOK_DWG2DXF_CMD='ODAFileConverter {in_dir} {out_dir} ACAD2013 DXF 0 1'
                #  - export GABLOK_DXF2DWG_CMD='ODAFileConverter {in_dir} {out_dir} ACAD2013 DWG 0 1'
                # For simple converters, you can use: 'dwg2dxf {in} {out}'
                cmd_key = 'GABLOK_DWG2DXF_CMD' if path == '/api/dwg/to-dxf' else 'GABLOK_DXF2DWG_CMD'
                cmd_tpl = os.environ.get(cmd_key) or os.environ.get(cmd_key.replace('GABLOK_', ''))
                if not cmd_tpl:
                    return _send_json(501, {
                        'error': 'dwg-converter-not-configured',
                        'message': f"{cmd_key} is not set on the server. Install/configure a DWG converter CLI and set this env var.",
                        'requiredEnv': cmd_key
                    })

                filename = str(data.get('filename') or '').strip() or ('input.dwg' if path == '/api/dwg/to-dxf' else 'input.dxf')

                with tempfile.TemporaryDirectory(prefix='gablok-dwg-') as td:
                    # Some converters (notably ODAFileConverter) require output folder != input folder.
                    in_dir = os.path.join(td, 'in')
                    out_dir = os.path.join(td, 'out')
                    os.makedirs(in_dir, exist_ok=True)
                    os.makedirs(out_dir, exist_ok=True)

                    in_path = os.path.join(in_dir, filename)
                    out_path = os.path.join(out_dir, 'out.dxf' if path == '/api/dwg/to-dxf' else 'out.dwg')

                    if path == '/api/dwg/to-dxf':
                        # Accept either bytesBase64 (preferred) or dwgBase64 (legacy/client alias)
                        b64 = data.get('bytesBase64') or data.get('dwgBase64')
                        if not isinstance(b64, str) or not b64:
                            return _send_json(400, { 'error': 'bad-request', 'message': 'Missing bytesBase64 (or dwgBase64) for DWG input.' })
                        try:
                            raw_in = base64.b64decode(b64, validate=False)
                        except Exception as exc:
                            return _send_json(400, { 'error': 'bad-request', 'message': 'Invalid base64 payload.', 'detail': str(exc) })
                        try:
                            with open(in_path, 'wb') as f:
                                f.write(raw_in)
                        except Exception as exc:
                            return _send_json(500, { 'error': 'write-failed', 'message': 'Failed to write input file.', 'detail': str(exc) })
                    else:
                        # DXF -> DWG
                        dxf_text = data.get('dxfText')
                        dxf_b64 = data.get('dxfBase64')
                        raw_dxf: bytes = b''
                        if isinstance(dxf_b64, str) and dxf_b64:
                            try:
                                raw_dxf = base64.b64decode(dxf_b64, validate=False)
                            except Exception as exc:
                                return _send_json(400, { 'error': 'bad-request', 'message': 'Invalid dxfBase64 payload.', 'detail': str(exc) })
                        elif isinstance(dxf_text, str) and dxf_text:
                            raw_dxf = dxf_text.encode('utf-8')
                        else:
                            return _send_json(400, { 'error': 'bad-request', 'message': 'Missing dxfText or dxfBase64.' })
                        try:
                            with open(in_path, 'wb') as f:
                                f.write(raw_dxf)
                        except Exception as exc:
                            return _send_json(500, { 'error': 'write-failed', 'message': 'Failed to write input file.', 'detail': str(exc) })

                    # Expand placeholders
                    # Supported placeholders:
                    #  {in} {out} {in_dir} {out_dir}
                    expanded = (cmd_tpl
                                .replace('{in}', in_path)
                                .replace('{out}', out_path)
                                .replace('{in_dir}', in_dir)
                                .replace('{out_dir}', out_dir))
                    try:
                        args = shlex.split(expanded)
                    except Exception:
                        args = expanded.split(' ')
                    if not args or not args[0]:
                        return _send_json(500, { 'error': 'converter-misconfigured', 'message': f"{cmd_key} is empty after expansion." })

                    try:
                        proc = subprocess.run(
                            args,
                            cwd=td,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            timeout=300
                        )
                    except FileNotFoundError:
                        return _send_json(501, { 'error': 'converter-not-found', 'message': f"Converter binary not found for {cmd_key}.", 'cmd': args[0] })
                    except subprocess.TimeoutExpired:
                        return _send_json(504, { 'error': 'converter-timeout', 'message': 'Conversion timed out.' })
                    except Exception as exc:
                        return _send_json(500, { 'error': 'converter-failed', 'message': 'Conversion failed to execute.', 'detail': str(exc) })

                    if proc.returncode != 0:
                        return _send_json(502, {
                            'error': 'converter-error',
                            'message': 'Converter returned non-zero exit code.',
                            'code': int(proc.returncode),
                            'stdout': (proc.stdout or b'')[:2000].decode('utf-8', errors='replace'),
                            'stderr': (proc.stderr or b'')[:4000].decode('utf-8', errors='replace')
                        })

                    if not os.path.exists(out_path):
                        # Some directory-based converters may write a different output name.
                        # As a fallback, try to find the first matching output extension.
                        want_ext = '.dxf' if path == '/api/dwg/to-dxf' else '.dwg'
                        found = None
                        try:
                            for name in os.listdir(out_dir):
                                if name.lower().endswith(want_ext):
                                    found = os.path.join(out_dir, name)
                                    break
                        except Exception:
                            found = None
                        if not found or not os.path.exists(found):
                            return _send_json(502, {
                                'error': 'no-output',
                                'message': 'Converter produced no output file.',
                                'stdout': (proc.stdout or b'')[:2000].decode('utf-8', errors='replace'),
                                'stderr': (proc.stderr or b'')[:4000].decode('utf-8', errors='replace')
                            })
                        out_path = found

                    try:
                        out_bytes = open(out_path, 'rb').read()
                    except Exception as exc:
                        return _send_json(500, { 'error': 'read-failed', 'message': 'Failed to read output file.', 'detail': str(exc) })

                    if path == '/api/dwg/to-dxf':
                        # Return DXF as UTF-8 text (and also base64 for safety)
                        try:
                            dxf_text_out = out_bytes.decode('utf-8', errors='replace')
                        except Exception:
                            dxf_text_out = ''
                        return _send_json(200, {
                            'ok': True,
                            'dxfText': dxf_text_out,
                            'dxfBase64': base64.b64encode(out_bytes).decode('ascii'),
                            'mime': 'application/dxf'
                        })
                    else:
                        return _send_json(200, {
                            'ok': True,
                            'bytesBase64': base64.b64encode(out_bytes).decode('ascii'),
                            'mime': 'application/acad'
                        })
            except Exception as exc:
                return _send_json(500, { 'error': 'dwg-endpoint-failed', 'message': str(exc) })
        
        # Fallback to default handler for other POSTs
        # Unknown POST route
        self.send_response(404)
        self.send_header('Content-Type','text/plain; charset=utf-8')
        self.end_headers()
        try:
            self.wfile.write(b'Not Found')
        except Exception:
            pass


class ReusableHTTPServer(ThreadingHTTPServer):
    # Threaded server to serve concurrent requests to avoid proxy 504s under burst loads
    allow_reuse_address = True
    daemon_threads = True


def run(host='0.0.0.0', port=8000, directory=None):
    if directory is None:
        directory = os.path.abspath('.')
    handler = lambda *args, **kwargs: NoCacheHandler(*args, directory=directory, **kwargs)
    httpd = None
    bind_error = None
    try:
        httpd = ReusableHTTPServer((host, port), handler)
    except OSError as e:
        bind_error = e
        # If the address is already in use, attempt a small range of fallback ports
        try:
            err_no = getattr(e, 'errno', None)
        except Exception:
            err_no = None
        if err_no in (98, 48) or 'Address already in use' in str(e):
            base_port = int(port)
            for p in range(base_port + 1, base_port + 21):
                try:
                    httpd = ReusableHTTPServer((host, p), handler)
                    port = p
                    print(f"Port {base_port} busy, switched to {p}", flush=True)
                    bind_error = None
                    break
                except OSError:
                    continue
        if httpd is None:
            print(f"Failed to bind to {host}:{port} -> {bind_error}")
            if bind_error is not None:
                raise bind_error
            raise OSError('Failed to bind HTTP server')
    # Expose the bound port to handlers for URL generation
    try:
        os.environ['GABLOK_BOUND_PORT'] = str(port)
    except Exception:
        pass
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
    # Prefer PORT from environment if provided (Codespaces/Gitpod/CI), fallback to 8000
    try:
        default_port = int(os.environ.get('PORT') or 8000)
    except Exception:
        default_port = 8000
    default_dir = os.path.abspath(os.environ.get('SERVE_DIR', '.'))

    parser = argparse.ArgumentParser(description='Lightweight no-cache static server for development.')
    parser.add_argument('--host', default=default_host, help=f'Host interface to bind (default: {default_host})')
    parser.add_argument('--port', type=int, default=default_port, help=f'Port to listen on (default: {default_port})')
    parser.add_argument('--dir', dest='directory', default=default_dir, help=f'Directory to serve (default: {default_dir})')
    args = parser.parse_args()

    run(host=args.host, port=args.port, directory=os.path.abspath(args.directory))

from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import socket
import argparse
import json
from urllib.parse import urlparse, parse_qs
import time

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
            
            # Ensure image has data URI prefix for Freepik
            image_data = base64_image_data
            if not image_data.startswith('data:'):
                image_data = 'data:image/png;base64,' + image_data
            
            # Use mystic endpoint - supports both image reference and prompt
            # Always use widescreen 16:9 for landscape output
            # num_images=1 ensures single generation
            endpoints_to_try.append(
                (base_url + '/v1/ai/mystic', {
                    'image': {'url': image_data},
                    'prompt': prompt,
                    'aspect_ratio': 'widescreen_16_9',
                    'num_images': 1
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
                    quality_val = float(quality)
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
            raise bind_error
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

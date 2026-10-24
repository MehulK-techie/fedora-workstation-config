"""Phone sync for MK Notes: a small server on your Wi-Fi that the phone app
(assets/notes-web, also packaged as the Android app) syncs with.

Only devices that have the pairing key can read or change anything; the key is
in ~/.config/mk-workstation/notes-token (shown as a QR code in MK Notes ›
Phone). It runs while MK Notes runs with Phone sync on, or with
`mk-notes --serve`.

With PyNaCl installed (python3-pynacl), every API message both ways is also
encrypted (NaCl secretbox, XSalsa20-Poly1305, key = first 32 bytes of
SHA-512 of the pairing key) and marked X-MK-Enc: 1; the phone uses the same
with tweetnacl. Without it, sync still works, signed but readable on the
Wi-Fi, and the phone shows that.

Every API request is signed with the key (HMAC-SHA1 of "METHOD PATH TIME
BODY-SHA1" in X-MK-Sig, the time in X-MK-Time), so nothing can be changed on
the way; the key itself never crosses the network and
a captured request can't be replayed. The notes themselves travel unencrypted
on your Wi-Fi, so turn Phone sync on at home, not on public Wi-Fi.

API:
  GET    /api/manifest                 every note and attachment with its hash
  GET    /api/file?path=P              a file
  PUT    /api/file?path=P&base=H       write P; H is the hash the phone started from
  DELETE /api/file?path=P&base=H       delete P (to the vault's trash)
If the laptop changed P since H, a PUT keeps both: the phone's version is saved
as "P (phone conflict <time>).md", like Obsidian Sync does.
"""
import hashlib
import hmac
import json
import os
import secrets
import socket
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import notes

try:
    from nacl.encoding import RawEncoder
    from nacl.exceptions import CryptoError
    from nacl.hash import sha512
    from nacl.secret import SecretBox
except ImportError:  # sync still works, unencrypted (signed)
    SecretBox = None

TOKEN_FILE = notes.CONFIG_DIR / "notes-token"
MAX_UPLOAD = 50 * 1024 * 1024
CLOCK_SKEW = 600  # seconds a phone's clock may differ from the laptop's
WEB_DIRS = (Path(__file__).resolve().parents[2] / "assets/notes-web",
            notes.DATA_DIR / "assets/notes-web")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
         ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".gif": "image/gif", ".webp": "image/webp", ".md": "text/markdown; charset=utf-8",
         ".webmanifest": "application/manifest+json", ".pdf": "application/pdf"}


def token():
    try:
        value = TOKEN_FILE.read_text().strip()
        if len(value) >= 32:
            return value
    except OSError:
        pass
    value = secrets.token_urlsafe(24)
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.touch(mode=0o600)
    TOKEN_FILE.write_text(value + "\n")
    return value


def secret_box():
    """The shared box for encrypting sync messages, or None without PyNaCl."""
    if SecretBox is None:
        return None
    return SecretBox(sha512(token().encode(), encoder=RawEncoder)[:32])


def new_token():
    TOKEN_FILE.unlink(missing_ok=True)
    return token()


def lan_address():
    """This computer's address on the local network (no traffic is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def web_dir():
    return next((d for d in WEB_DIRS if (d / "index.html").is_file()), None)


class Server:
    def __init__(self, vault, port=8765, on_change=None):
        self.vault = vault
        self.port = int(port)
        self.on_change = on_change or (lambda rel: None)
        self.lock = threading.Lock()
        self.httpd = None
        self.seen = {}  # signatures already used: no replays

    @property
    def url(self):
        return f"http://{lan_address()}:{self.port}/"

    def pairing_url(self):
        # enc=1: the phone must expect encryption from now on (no downgrade).
        return f"{self.url}#key={token()}" + ("&enc=1" if secret_box() else "")

    def start(self):
        if self.httpd:
            return
        server = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "MKNotes/1"

            def log_message(self, *_):
                pass

            def _send(self, code, body=b"", ctype="application/json"):
                if isinstance(body, (dict, list)):
                    body = json.dumps(body).encode()
                elif isinstance(body, str):
                    body = body.encode()
                box = secret_box() if self.path.startswith("/api/") and code in (200, 409) else None
                if box:
                    # The sealed reply names the exact request it answers (its
                    # path with the phone's random n= and its signature), so an
                    # old reply can't be replayed as the answer to a new one.
                    echo = f"{self.command} {self.path} {self.headers.get('X-MK-Sig', '')}\n"
                    body = bytes(box.encrypt(echo.encode() + body))
                    ctype = "application/octet-stream"
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                if box:
                    self.send_header("X-MK-Enc", "1")
                self.send_header("Content-Length", str(len(body)))
                # The Android app loads its page from the phone, not from here.
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "X-MK-Time, X-MK-Sig, X-MK-Enc, Content-Type")
                self.send_header("Access-Control-Expose-Headers", "X-MK-Enc")
                self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def _authorised(self, body=b""):
                stamp = self.headers.get("X-MK-Time", "")
                sig = self.headers.get("X-MK-Sig", "")
                try:
                    if abs(time.time() - int(stamp)) > CLOCK_SKEW:
                        return False
                except ValueError:
                    return False
                message = f"{self.command} {self.path} {stamp} {hashlib.sha1(body).hexdigest()}".encode()
                expected = hmac.new(token().encode(), message, hashlib.sha1).hexdigest()
                if not hmac.compare_digest(sig, expected):
                    return False
                with server.lock:
                    now = time.time()
                    server.seen = {k: t for k, t in server.seen.items() if now - t < 2 * CLOCK_SKEW}
                    if sig in server.seen:
                        return False
                    server.seen[sig] = now
                return True

            def _target(self, query):
                rel = query.get("path", [""])[0].lstrip("/")
                parts = Path(rel).parts
                if not rel or any(p.startswith(".") or p == ".." for p in parts):
                    raise ValueError("bad path")
                if not (rel.endswith(".md") or parts[0] == "attachments"):
                    raise ValueError("only notes and attachments sync")
                server.vault.path(rel)  # raises outside the vault
                return rel

            def do_OPTIONS(self):
                self._send(204)

            def do_GET(self):
                url = urlparse(self.path)
                if not url.path.startswith("/api/"):
                    return self._static(url.path)
                if not self._authorised():
                    return self._send(401, {"error": "pairing key needed"})
                query = parse_qs(url.query)
                if url.path == "/api/manifest":
                    with server.lock:
                        return self._send(200, server.vault.manifest())
                if url.path == "/api/file":
                    try:
                        rel = self._target(query)
                        data = server.vault.path(rel).read_bytes()
                    except (ValueError, OSError):
                        return self._send(404, {"error": "not found"})
                    return self._send(200, data, TYPES.get(Path(rel).suffix.lower(), "application/octet-stream"))
                self._send(404, {"error": "unknown"})

            def do_PUT(self):
                url = urlparse(self.path)
                query = parse_qs(url.query)
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    return self._send(400, {"error": "bad length"})
                if length < 0 or length > MAX_UPLOAD:
                    return self._send(413, {"error": "too large"})
                data = self.rfile.read(length)
                if not self._authorised(data):
                    return self._send(401, {"error": "pairing key needed"})
                box = secret_box()
                if box:
                    # Encryption available: never accept a plain upload (no downgrade).
                    if self.headers.get("X-MK-Enc") != "1":
                        return self._send(400, {"error": "encryption required"})
                    try:
                        data = box.decrypt(data)
                    except CryptoError:
                        return self._send(400, {"error": "could not decrypt"})
                try:
                    rel = self._target(query)
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
                base = query.get("base", [""])[0]
                with server.lock:
                    path = server.vault.path(rel)
                    current = notes.digest(path.read_bytes()) if path.exists() else ""
                    new = notes.digest(data)
                    if current and current != base and current != new:
                        stamp = datetime.now().strftime("%Y-%m-%d %H%M")
                        stem = Path(rel).stem
                        folder = Path(rel).parent.as_posix()
                        rel = server.vault.unique("" if folder == "." else folder,
                                                  f"{stem} (phone conflict {stamp})", Path(rel).suffix)
                        path = server.vault.path(rel)
                        conflict = True
                    else:
                        conflict = False
                    if rel.endswith(".md"):
                        server.vault.write(rel, data.decode("utf-8", "replace"))
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(data)
                    server.vault.save_state()
                server.on_change(rel)
                self._send(200, {"path": rel, "hash": new, "conflict": conflict})

            def do_DELETE(self):
                if not self._authorised():
                    return self._send(401, {"error": "pairing key needed"})
                query = parse_qs(urlparse(self.path).query)
                try:
                    rel = self._target(query)
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
                with server.lock:
                    path = server.vault.path(rel)
                    if path.exists():
                        if notes.digest(path.read_bytes()) != query.get("base", [""])[0]:
                            return self._send(409, {"error": "changed on the laptop"})
                        server.vault.delete(rel)
                server.on_change(rel)
                self._send(200, {"deleted": rel})

            def _static(self, path):
                folder = web_dir()
                name = path.strip("/") or "index.html"
                if not folder or "/" in name or name.startswith("."):
                    return self._send(404, "not found", "text/plain")
                file = folder / name
                if not file.is_file():
                    return self._send(404, "not found", "text/plain")
                self._send(200, file.read_bytes(), TYPES.get(file.suffix, "application/octet-stream"))

        # Only on the Wi-Fi address (not VPNs, containers or other networks).
        self.httpd = ThreadingHTTPServer((lan_address(), self.port), Handler)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None


def serve_forever(port=None):
    """`mk-notes --serve`: sync without the window open."""
    vault = notes.Vault()
    server = Server(vault, port or notes.load_conf().get("SYNC_PORT", 8765))
    server.start()
    print(f"MK Notes phone sync on {server.url} (vault: {vault.root}). Ctrl+C stops.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.stop()


if __name__ == "__main__":
    serve_forever(os.environ.get("MK_NOTES_PORT"))

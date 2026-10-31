#!/usr/bin/env python3
"""Private CPU-only character timing service for the development environment."""
import hmac
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("MODELSCOPE_OFFLINE", "1")

from funasr import AutoModel  # noqa: E402

TOKEN = os.environ.get("ALIGN_SERVICE_TOKEN", "")
PORT = int(os.environ.get("ALIGN_PORT", "18095"))
MODEL_DIR = os.environ.get("ALIGN_MODEL_DIR", "/model")
MAX_BYTES = 24 * 1024 * 1024
LOCK = threading.Lock()
if len(TOKEN) < 32:
    raise RuntimeError("ALIGN_SERVICE_TOKEN must be configured")
MODEL = AutoModel(model=MODEL_DIR, device="cpu", ncpu=2, disable_update=True, log_level="ERROR")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_json(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + TOKEN)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"status": "ok"})
        return self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/align":
            return self.send_json(404, {"error": "not_found"})
        if not self.authorized():
            return self.send_json(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length < 44 or length > MAX_BYTES:
            return self.send_json(400, {"error": "invalid_audio_size"})
        if not LOCK.acquire(timeout=180):
            return self.send_json(429, {"error": "busy"})
        filename = None
        try:
            fd, filename = tempfile.mkstemp(suffix=".wav", prefix="xtzc-align-")
            with os.fdopen(fd, "wb") as handle:
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise ValueError("truncated_audio")
                    handle.write(chunk)
                    remaining -= len(chunk)
            items = MODEL.generate(input=filename, batch_size=1, disable_pbar=True)
            item = items[0] if items else {}
            words = str(item.get("text") or "").split()
            times = item.get("timestamp") or []
            if len(words) != len(times) or not words:
                return self.send_json(422, {"error": "timestamps_unavailable"})
            tokens = []
            for word, interval in zip(words, times):
                if not isinstance(interval, (list, tuple)) or len(interval) < 2:
                    raise ValueError("invalid_timestamp")
                start, end = float(interval[0]) / 1000, float(interval[1]) / 1000
                if start < 0 or end <= start:
                    raise ValueError("invalid_timestamp")
                tokens.append({"text": word, "start": start, "end": end})
            return self.send_json(200, {"tokens": tokens})
        except Exception:
            return self.send_json(500, {"error": "alignment_failed"})
        finally:
            LOCK.release()
            if filename:
                try:
                    os.unlink(filename)
                except OSError:
                    pass

    def log_message(self, fmt, *args):
        # Never log raw audio, recognized words, tokens, or credentials.
        pass


if __name__ == "__main__":
    print("[xtzc-align] ready on CPU", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

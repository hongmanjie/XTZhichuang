#!/usr/bin/env python3
"""VSR 画面文字修复服务。

协议刻意做成最简单的“裸字节上传下载”，不依赖共享卷，也不依赖额外框架：
  POST /repair?bandTop=0.82&bandBottom=1&mode=sttn-det
      请求体：原始 mp4 字节
      响应：修复后的 mp4 字节；失败时返回 JSON {"ok": false, "error": "..."}
  GET  /health

这样服务部署在哪台机器都行，调用方只要能发 HTTP 就能用。
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("VSR_PORT", "8198"))
JOB_TIMEOUT = int(os.environ.get("VSR_JOB_TIMEOUT", "900"))
LOCK = threading.Lock()


def find_main():
    candidates = [
        os.path.join(os.getcwd(), "backend", "main.py"),
        "/vsr/backend/main.py",
        "/app/backend/main.py",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    for root in ("/vsr", "/app", os.getcwd()):
        for dirpath, _dirnames, filenames in os.walk(root):
            if "main.py" in filenames and dirpath.endswith("backend"):
                return os.path.join(dirpath, "main.py")
    return None


MAIN_PY = find_main()
WORKDIR = os.path.dirname(os.path.dirname(MAIN_PY)) if MAIN_PY else os.getcwd()


def probe_size(path):
    # 镜像里没有 ffprobe，用自带的 OpenCV 读尺寸
    try:
        import cv2
        cap = cv2.VideoCapture(path)
        if cap.isOpened():
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()
            if width and height:
                return width, height
    except Exception:
        pass
    return None, None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _video(self, data, seconds):
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Repair-Seconds", str(seconds))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path.rstrip("/") in ("/health", ""):
            return self._json(200, {"ok": True, "main": MAIN_PY, "workdir": WORKDIR})
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") != "/repair":
            return self._json(404, {"ok": False, "error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"ok": False, "error": "Content-Length 无效"})
        if length <= 0 or length > 200 * 1024 * 1024:
            return self._json(400, {"ok": False, "error": "视频大小超出范围"})
        if not LOCK.acquire(blocking=False):
            return self._json(429, {"ok": False, "error": "已有修复任务在跑"})
        source = target = None
        try:
            query = parse_qs(parsed.query)
            band_top = float((query.get("bandTop") or ["0.82"])[0])
            band_bottom = float((query.get("bandBottom") or ["1"])[0])
            mode = (query.get("mode") or ["sttn-det"])[0]

            fd, source = tempfile.mkstemp(suffix=".mp4", prefix="vsr_in_")
            with os.fdopen(fd, "wb") as handle:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    handle.write(chunk)
                    remaining -= len(chunk)

            width, height = probe_size(source)
            if not width or not height:
                return self._json(500, {"ok": False, "error": "无法读取视频尺寸"})
            regions = []
            areas_raw = (query.get("areas") or [""])[0].strip()
            if areas_raw:
                for part in areas_raw.split(";"):
                    try:
                        vals = [float(v) for v in part.split(",")]
                    except ValueError:
                        continue
                    if len(vals) != 4:
                        continue
                    t, b, l, r = vals
                    y1 = max(0, min(height - 2, int(height * t)))
                    y2 = max(y1 + 2, min(height, int(height * b)))
                    x1 = max(0, min(width - 2, int(width * l)))
                    x2 = max(x1 + 2, min(width, int(width * r)))
                    regions.append((y1, y2, x1, x2))
            if not regions:
                ymin = max(0, min(height - 2, int(height * band_top)))
                ymax = max(ymin + 2, min(height, int(height * band_bottom)))
                regions.append((ymin, ymax, 0, width))
            # target 之前初始化为 None 后再没赋值，VSR 收到 None 直接抛
            # "expected str, bytes or os.PathLike object, not NoneType"。
            out_fd, target = tempfile.mkstemp(suffix=".mp4", prefix="vsr_out_")
            os.close(out_fd)
            os.unlink(target)  # 让 VSR 自己创建，避免空文件导致它跳过写盘
            cmd = [sys.executable, MAIN_PY, "-i", source, "-o", target]
            for (y1, y2, x1, x2) in regions:
                cmd += ["-c", str(y1), str(y2), str(x1), str(x2)]
            cmd += ["--inpaint-mode", mode]
            started = time.time()
            try:
                proc = subprocess.run(cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=JOB_TIMEOUT)
            except subprocess.TimeoutExpired:
                return self._json(504, {"ok": False, "error": "修复超时"})
            cost = round(time.time() - started, 2)
            if proc.returncode != 0 or not os.path.isfile(target) or os.path.getsize(target) < 1024:
                merged = (proc.stderr or "") + "\n" + (proc.stdout or "")
                # 进度条会刷满 stderr，只取最后一段 traceback
                marker = merged.rfind("Traceback (most recent call last)")
                detail = (merged[marker:] if marker >= 0 else merged).strip()
                if len(detail) > 900:
                    detail = detail[:200] + " ... " + detail[-700:]
                print("[vsr] FAILED rc=%s %s" % (proc.returncode, detail.replace("\n", " | ")[:600]), flush=True)
                return self._json(500, {"ok": False, "error": "修复失败: " + detail, "seconds": cost})

            with open(target, "rb") as handle:
                payload = handle.read()
            print(f"[vsr] ok {width}x{height} regions={regions} {cost}s {len(payload)}B", flush=True)
            self._video(payload, cost)
        except Exception as error:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(error)[:300]})
        finally:
            LOCK.release()
            for path in (source, target):
                if path and os.path.exists(path):
                    try:
                        os.unlink(path)
                    except OSError:
                        pass

    def log_message(self, fmt, *args):
        sys.stderr.write("[vsr] " + fmt % args + "\n")


if __name__ == "__main__":
    if not MAIN_PY:
        sys.stderr.write("[vsr] 未找到 backend/main.py\n")
    print(f"[vsr] main={MAIN_PY} workdir={WORKDIR} port={PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

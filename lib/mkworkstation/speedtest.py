"""Speed test engine for mk speedtest and the MK Speedtest app.

Cloudflare (speed.cloudflare.com, the default): several streams at once, the
way fast connections are measured properly; one HTTP stream can't fill a
fibre line. Downloads run 6 streams and uploads 4, for a fixed time; the
first second (TCP slow start) is left out of the result.

  latency    the median of 10 small requests, best 8 kept; jitter is the
             mean difference between consecutive ones
  download   6 x 25 MB requests, repeated, for 8 s
  upload     4 x 8 MB posts, repeated, for 8 s

Ookla (mode="ookla"): the speedtest-cli tool picks the nearest Ookla server
(as speedtest.net does) and runs its own test; installed by setup.sh.

on_update(phase, mbps_or_ms, done_fraction) is called from worker threads,
about ten times a second, so a UI can animate a gauge.
"""
import json
import shutil
import statistics
import subprocess
import threading
import time
import urllib.request

HOST = "https://speed.cloudflare.com"
UA = {"User-Agent": "mk-speedtest/2"}
DOWN_STREAMS, UP_STREAMS = 6, 4
DOWN_BYTES, UP_BYTES = 25_000_000, 8_000_000
PHASE_SECONDS, WARMUP = 8.0, 1.0


class Cancelled(Exception):
    pass


class SpeedTest:
    def __init__(self, on_update=lambda *_: None, mode="cloudflare"):
        self.on_update = on_update
        self.mode = mode
        self.cancelled = threading.Event()
        self.result = {}

    def cancel(self):
        self.cancelled.set()

    def run(self):
        if self.mode == "ookla":
            return self._ookla()
        ping, jitter = self.latency()
        self.result.update(ping=ping, jitter=jitter)
        self.result["download"] = self._throughput("download")
        self.result["upload"] = self._throughput("upload")
        self.result["server"] = "Cloudflare (nearest location)"
        return self.result

    # ----- latency
    def latency(self, count=10):
        times = []
        for i in range(count):
            if self.cancelled.is_set():
                raise Cancelled()
            start = time.perf_counter()
            with urllib.request.urlopen(urllib.request.Request(f"{HOST}/__down?bytes=0", headers=UA),
                                        timeout=10) as r:
                r.read()
            times.append((time.perf_counter() - start) * 1000)
            self.on_update("ping", min(times), (i + 1) / count)
        best = sorted(times)[: max(1, count - 2)]  # the slowest are usually connection setup
        steady = times[2:] or times  # the first requests include connection setup
        jitter = statistics.mean(abs(a - b) for a, b in zip(steady, steady[1:])) if len(steady) > 1 else 0.0
        return statistics.median(best), jitter

    # ----- throughput
    def _throughput(self, phase):
        counted = [0]
        lock = threading.Lock()
        start = time.perf_counter()
        stop_at = start + PHASE_SECONDS
        payload = b"0" * UP_BYTES

        def add(n):
            with lock:
                counted[0] += n

        def download():
            while time.perf_counter() < stop_at and not self.cancelled.is_set():
                req = urllib.request.Request(f"{HOST}/__down?bytes={DOWN_BYTES}", headers=UA)
                with urllib.request.urlopen(req, timeout=15) as r:
                    while chunk := r.read(64 * 1024):
                        add(len(chunk))
                        if time.perf_counter() >= stop_at or self.cancelled.is_set():
                            return

        def upload():
            while time.perf_counter() < stop_at and not self.cancelled.is_set():
                def body():
                    for i in range(0, UP_BYTES, 64 * 1024):
                        if time.perf_counter() >= stop_at or self.cancelled.is_set():
                            return
                        piece = payload[i:i + 64 * 1024]
                        add(len(piece))
                        yield piece
                req = urllib.request.Request(f"{HOST}/__up", data=body(), method="POST",
                                             headers={**UA, "Content-Type": "application/octet-stream"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as r:
                        r.read()
                except OSError:
                    if time.perf_counter() < stop_at and not self.cancelled.is_set():
                        raise

        work = download if phase == "download" else upload
        streams = DOWN_STREAMS if phase == "download" else UP_STREAMS
        errors = []

        def guard():
            try:
                work()
            except OSError as e:
                errors.append(e)
        threads = [threading.Thread(target=guard, daemon=True) for _ in range(streams)]
        for t in threads:
            t.start()
        # Measure after the warm-up, in 100 ms steps (also feeds the gauge).
        base_bytes, base_time = None, None
        last_bytes, last_time = 0, start
        while any(t.is_alive() for t in threads):
            time.sleep(0.1)
            now = time.perf_counter()
            with lock:
                total = counted[0]
            instant = (total - last_bytes) * 8 / 1e6 / max(1e-3, now - last_time)
            last_bytes, last_time = total, now
            if base_time is None and now - start >= WARMUP:
                base_bytes, base_time = total, now
            if base_time is not None and now > base_time:
                avg = (total - base_bytes) * 8 / 1e6 / (now - base_time)
                shown = 0.6 * avg + 0.4 * instant  # steady, but still alive
            else:
                shown = instant
            self.on_update(phase, shown, min(1.0, (now - start) / PHASE_SECONDS))
            if self.cancelled.is_set():
                raise Cancelled()
        if base_time is None or last_time <= base_time:
            if errors:
                raise errors[0]
            return 0.0
        return (last_bytes - base_bytes) * 8 / 1e6 / (last_time - base_time)

    # ----- Ookla, through speedtest-cli
    def _ookla(self):
        tool = shutil.which("speedtest-cli") or shutil.which("speedtest")
        if not tool:
            raise RuntimeError("speedtest-cli isn't installed (sudo dnf install speedtest-cli)")
        self.on_update("ping", 0, 0.0)
        proc = subprocess.Popen([tool, "--json", "--secure"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True)
        start = time.perf_counter()
        while proc.poll() is None:
            if self.cancelled.is_set():
                proc.kill()
                raise Cancelled()
            elapsed = time.perf_counter() - start
            phase = "ping" if elapsed < 5 else "download" if elapsed < 18 else "upload"
            self.on_update(phase, 0, min(1.0, elapsed / 30))
            time.sleep(0.2)
        out, err = proc.communicate()
        if proc.returncode:
            raise RuntimeError(err.strip() or "speedtest-cli failed")
        data = json.loads(out)
        server = data.get("server", {})
        self.result = {"ping": data.get("ping", 0), "jitter": 0.0, "download": data.get("download", 0) / 1e6,
                       "upload": data.get("upload", 0) / 1e6,
                       "server": f"Ookla: {server.get('sponsor', '?')}, {server.get('name', '')}"}
        return self.result

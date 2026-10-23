"""What this computer is and has, and what MK does about it (`mk device`).

Everything here is detected, never assumed, so the same code tunes an
HP ENVY x360, a ThinkPad or a desktop tower correctly.
"""
import glob
import os
import re
import shutil
import subprocess
from pathlib import Path

from . import CONFIG_DIR


def _read(path, default=""):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


def _run(*argv, timeout=5):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _input_names():
    return {_read(p) for p in glob.glob("/sys/class/input/*/device/name")}


def detect():
    d = {}
    vendor, product = _read("/sys/class/dmi/id/sys_vendor"), _read("/sys/class/dmi/id/product_name")
    d["model"] = product if product.startswith(vendor) else f"{vendor} {product}".strip()
    d["chassis"] = _run("hostnamectl", "chassis").strip() or "unknown"
    cpu = re.search(r"model name\s*:\s*(.+)", _read("/proc/cpuinfo"))
    d["cpu"] = cpu.group(1) if cpu else "unknown"
    d["cores"] = os.cpu_count() or 0
    d["cpufreq"] = _read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_driver", "unknown")
    d["cppc"] = Path("/sys/devices/system/cpu/cpu0/acpi_cppc").exists()
    mem = re.search(r"MemTotal:\s*(\d+)", _read("/proc/meminfo"))
    d["ram_gb"] = round(int(mem.group(1)) / 1048576, 1) if mem else 0
    gpu = _run("lspci")
    d["gpu"] = "; ".join(line.split(": ", 1)[-1] for line in gpu.splitlines()
                         if re.search(r"VGA|3D|Display", line)) or "unknown"
    va = _run("vainfo") if shutil.which("vainfo") else ""
    d["video_decode"] = sorted({c for c, pat in (("H.264", "H264"), ("HEVC", "HEVC"), ("VP9", "VP9"),
                                                 ("AV1", "AV1")) if re.search(pat + r".*VLD", va)})
    d["battery"] = bool(glob.glob("/sys/class/power_supply/BAT*"))
    if d["battery"]:
        bat = sorted(glob.glob("/sys/class/power_supply/BAT*"))[0]
        d["battery_percent"] = _read(f"{bat}/capacity")
        d["charge_limit"] = Path(f"{bat}/charge_control_end_threshold").exists()
    names = _input_names()
    d["touchscreen"] = any(re.search(r"touchscreen|ELAN2|Wacom|Finger", n, re.I)
                           and "Touchpad" not in n for n in names)
    d["stylus"] = any(re.search(r"stylus|pen", n, re.I) for n in names)
    d["touchpad"] = any("Touchpad" in n for n in names)
    d["cameras"] = sorted({_read(f"{v}/name").split(":")[0] for v in glob.glob("/sys/class/video4linux/*")})
    d["ir_camera"] = any(re.search(r"\bIR\b|infrared", c, re.I) for c in d["cameras"])
    fp = _run("gdbus", "call", "--system", "--dest", "net.reactivated.Fprint", "--object-path",
              "/net/reactivated/Fprint/Manager", "--method",
              "net.reactivated.Fprint.Manager.GetDevices")
    d["fingerprint"] = "Device/" in fp
    if d["fingerprint"] and shutil.which("fprintd-list"):
        listing = _run("fprintd-list", os.environ.get("USER", ""))
        reader = re.search(r"(?:enrolled for| on) (.+?)(?: \(|\.?$)", listing, re.M)
        d["fingerprint_reader"] = reader.group(1).strip(" .") if reader else "reader"
        d["fingers"] = len(re.findall(r"^\s*- #\d+: ", listing, re.M))
    auth = _run("authselect", "current")
    d["fingerprint_login"] = "with-fingerprint" in auth
    # Auto-rotation needs an accelerometer exposed through IIO.
    d["rotation_sensor"] = any("accel" in _read(f"{p}/name")
                               for p in glob.glob("/sys/bus/iio/devices/iio:device*"))
    d["hp_wmi_blocked"] = "hp_wmi" in _read("/proc/cmdline")
    d["effects"] = _read(CONFIG_DIR / "effects", "auto")
    return d


def report(d=None):
    d = d or detect()
    ok, warn = "\033[32m✔\033[0m", "\033[33m!\033[0m"
    lines = [f"\033[1m{d['model'] or 'This computer'}\033[0m  ({d['chassis']})", ""]

    def row(mark, label, text):
        lines.append(f"  {mark} {label:<13} {text}")

    pstate = ("amd-pstate" in d["cpufreq"] or "intel_pstate" in d["cpufreq"])
    row(ok, "CPU", f"{d['cpu']} · {d['cores']} threads · {d['cpufreq']}"
        + ("" if pstate or d["cppc"] else " (firmware has no CPPC, so smart power profiles do the tuning)"))
    row(ok, "Memory", f"{d['ram_gb']} GiB · effects {d['effects']}"
        + (" (auto picks full)" if d["effects"] == "auto" and d["ram_gb"] >= 4 and d["cores"] > 2 else ""))
    hw_full = {"H.264", "HEVC"} <= set(d["video_decode"])
    row(ok if hw_full else warn, "Video", f"{d['gpu']} · GPU decodes {', '.join(d['video_decode']) or 'nothing'}"
        + ("" if hw_full else "  → sudo ./setup.sh adds H.264/HEVC"))
    if d["battery"]:
        row(ok, "Battery", f"{d.get('battery_percent', '?')}% · smart power profiles (mk power)"
            + (" · charge limit supported" if d.get("charge_limit") else ""))
    if d["touchscreen"] or d["stylus"]:
        row(ok if d["rotation_sensor"] or d["chassis"] not in ("convertible", "tablet") else warn,
            "Touch", "touchscreen" + (" + stylus" if d["stylus"] else "")
            + (" · auto-rotation on" if d["rotation_sensor"] else
               " · no rotation sensor exposed by the firmware" if d["chassis"] in ("convertible", "tablet")
               else "")
            + (" (hp_wmi is blacklisted on the kernel command line, so tablet mode isn't reported)"
               if d["hp_wmi_blocked"] and d["chassis"] == "convertible" else ""))
    if d["fingerprint"]:
        fingers = d.get("fingers", 0)
        row(ok if fingers and d["fingerprint_login"] else warn, "Fingerprint",
            f"{d.get('fingerprint_reader', 'reader')} · {fingers} finger(s) enrolled"
            + ("" if fingers else "  → mk fingerprint")
            + ("" if d["fingerprint_login"] else "  · login off → sudo ./setup.sh"))
    if d["cameras"]:
        row(ok, "Camera", ", ".join(d["cameras"]) + (" · IR: strong face unlock" if d["ir_camera"]
                                                    else " · RGB: face unlock in good light (mk face)"))
    return "\n".join(lines)

"""Welcome greeting and its voice (shared by mk welcome, the Companion and
mk-voice; the shell extension reads the same welcome.conf).

Each greeting is rendered once to ~/.cache/mk-workstation/voice/<hash>.wav and
reused, so login plays it at once; `mk-voice prepare` renders every line the
welcome can pick (greetings.conf) in the background.
Voices, best first:
  - Piper neural TTS with a British male voice ("Alan"), if installed with
    `mk welcome voice install` (~260 MB in ~/.local/share/mk-workstation/voice)
  - espeak-ng's British Received Pronunciation voice (always available)
A little sox processing (lower pitch, warmth, short reverb) gives it the calm
"AI assistant" feel.
"""
import hashlib
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from gi.repository import GLib

from . import CONFIG_DIR, DATA_DIR, DEFAULTS_DIR

USER_CONF = CONFIG_DIR / "welcome.conf"
DEFAULT_CONF = DEFAULTS_DIR / "welcome.conf"
CACHE_DIR = Path(GLib.get_user_cache_dir()) / "mk-workstation"
VOICE_CACHE = CACHE_DIR / "voice"
GREETING_FILES = (DEFAULTS_DIR / "greetings.conf", CONFIG_DIR / "greetings.conf")
VOICE_DIR = DATA_DIR / "voice"
PIPER = VOICE_DIR / "venv/bin/piper"
MODEL = VOICE_DIR / "en_GB-alan-medium.onnx"
MODEL_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx"
TITLES = {"sir": "sir", "maam": "ma'am", "ma'am": "ma'am", "name": None, "none": ""}
DEFAULTS = {"WELCOME": "on", "GREETING": "Welcome back home, {title}.", "TITLE": "sir",
            "SUBTITLE": "on", "VOICE": "off", "EDGE_NOTIFY": "off",
            "COLOR_A": "#00c8ff", "COLOR_B": "#7c4dff"}


def _read(path):
    values = {}
    try:
        for line in Path(path).read_text().splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    except OSError:
        pass
    return values


def conf():
    return {**DEFAULTS, **_read(DEFAULT_CONF), **_read(USER_CONF)}


def set_value(key, value):
    """Change one setting in your welcome.conf, keeping the others."""
    values = _read(USER_CONF)
    values[key] = value.replace("\n", " ").strip()
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    USER_CONF.write_text("# Your welcome light settings (mk welcome, Quick Settings, Companion)\n"
                         + "".join(f"{k}={v}\n" for k, v in values.items()))


def first_name():
    name = GLib.get_real_name()
    return (name.split()[0] if name and name != "Unknown" else GLib.get_user_name()).strip()


def greeting(c=None, text=None):
    """The greeting (or text) with {title} and {name} filled in."""
    c = c or conf()
    title = TITLES.get(c.get("TITLE", "sir").lower(), c.get("TITLE", ""))
    if title is None:
        title = first_name()
    text = text or c["GREETING"]
    if not title:
        text = text.replace(", {title}", "").replace(" {title}", "").replace("{title}", "")
    return text.replace("{title}", title).replace("{name}", first_name()).strip()


def engine():
    if PIPER.exists() and MODEL.exists():
        return "piper"
    return "espeak" if shutil.which("espeak-ng") else None


def pool_lines(c=None):
    """Every greeting the welcome can pick, filled in (greetings.conf + yours)."""
    c = c or conf()
    lines = [c["GREETING"]]
    for path in GREETING_FILES:
        try:
            for line in Path(path).read_text().splitlines():
                line = line.strip()
                if line and not line.startswith(("#", "[")):
                    lines.append(line)
        except OSError:
            pass
    return list(dict.fromkeys(greeting(c, line) for line in lines))


def render(text=None, force=False):
    """Render a greeting to WAV once; later calls reuse it."""
    text = text or greeting()
    eng = engine()
    if not eng:
        return None
    key = hashlib.sha1(f"{eng}|{text}".encode()).hexdigest()
    wav = VOICE_CACHE / f"{key}.wav"
    if not force and wav.exists():
        return wav
    VOICE_CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.wav"
        if eng == "piper":
            subprocess.run([str(PIPER), "-m", str(MODEL), "-f", str(raw)], input=text,
                           text=True, capture_output=True, timeout=60, check=True)
        else:
            subprocess.run(["espeak-ng", "-v", "en-gb-x-rp", "-s", "148", "-p", "38", "-g", "3",
                            "-w", str(raw), text], capture_output=True, timeout=30, check=True)
        if shutil.which("sox"):
            pitch = "-40" if eng == "piper" else "-20"
            subprocess.run(["sox", str(raw), str(wav), "gain", "-4", "pitch", pitch, "bass", "+2",
                            "treble", "+2", "reverb", "18", "50", "70", "norm", "-2", "pad", "0", "0.4"],
                           capture_output=True, timeout=30, check=True)
        else:
            shutil.copy(raw, wav)
    return wav


def prepare():
    """Render every line in advance (skips ones already done)."""
    done = 0
    for line in pool_lines():
        if render(line):
            done += 1
    return done


def play(path):
    for player in ("pw-play", "paplay", "aplay"):
        if shutil.which(player):
            subprocess.Popen([player, str(path)], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            return True
    return False


def say(text=None, force=False):
    path = render(text, force=force)
    return bool(path) and play(path)


def install_natural_voice(progress=print):
    """Install Piper and the British "Alan" voice into ~/.local/share (no sudo)."""
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    venv = VOICE_DIR / "venv"
    if not PIPER.exists():
        progress("Creating the voice engine environment...")
        subprocess.run(["python3", "-m", "venv", str(venv)], check=True)
        progress("Downloading Piper (about 200 MB)...")
        subprocess.run([str(venv / "bin/pip"), "install", "-q", "piper-tts"], check=True)
    for url, dest in ((MODEL_URL, MODEL), (MODEL_URL + ".json", Path(str(MODEL) + ".json"))):
        if not dest.exists():
            progress(f"Downloading {dest.name}...")
            tmp = dest.with_suffix(dest.suffix + ".part")
            urllib.request.urlretrieve(url, tmp)
            os.replace(tmp, dest)
    progress("Rendering the greeting...")
    render(force=True)
    return True


def remove_natural_voice():
    shutil.rmtree(VOICE_DIR, ignore_errors=True)
    render(force=True)

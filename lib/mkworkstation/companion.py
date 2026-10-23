"""Companion data: notes, tasks and their reminders.

Stored in ~/.local/share/mk-workstation/companion.json. No GTK here, so the
once-a-minute reminder check (`mk-reminders`) and `mk note` / `mk task` stay
quick. Which reminders already fired is kept in a separate file
(reminders-state.json) that only the checker writes, so it never fights with
the Companion window over companion.json.
"""
import json
import re
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from . import DATA_DIR

STORE = DATA_DIR / "companion.json"
STATE = DATA_DIR / "reminders-state.json"
REPEATS = {"none": None, "daily": 86400, "weekly": 7 * 86400}
# A reminder missed by more than this (computer off) is dropped quietly.
STALE_AFTER = 12 * 3600


# ---------------------------------------------------------------- storage
def _read(path, default):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(path)


def load():
    data = _read(STORE, {})
    return {"notes": data.get("notes", []), "tasks": data.get("tasks", [])}


def save(data):
    _write(STORE, {"notes": data["notes"], "tasks": data["tasks"]})


def new_note(title="", body=""):
    return {"id": uuid.uuid4().hex, "title": title, "body": body, "pinned": False,
            "updated": time.time(), "remind_at": None, "repeat": "none"}


def new_task(text, done=False):
    return {"id": uuid.uuid4().hex, "text": text, "done": done, "pinned": False,
            "created": time.time(), "remind_at": None, "repeat": "none"}


def add(kind, item):
    """Add a note or task from outside the window (mk note / mk task)."""
    data = load()
    data[kind].insert(0, item)
    save(data)
    return item


# ---------------------------------------------------------------- times
def parse_when(text, now=None):
    """'30m', '2h', '1h30m', '90s', '18:00', 'tomorrow 9:00', 'tomorrow' -> epoch.
    Raises ValueError for anything else."""
    now = now or datetime.now()
    t = text.strip().lower()
    duration = re.fullmatch(r"(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?", t)
    if duration and any(duration.groups()):
        h, m, s = (int(g or 0) for g in duration.groups())
        return (now + timedelta(hours=h, minutes=m, seconds=s)).timestamp()
    day = now
    if t.startswith("tomorrow"):
        day = now + timedelta(days=1)
        t = t[len("tomorrow"):].strip() or "9:00"
    clock = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", t)
    if not clock:
        raise ValueError(f"can't read '{text}': try 30m, 2h, 18:00 or 'tomorrow 9:00'")
    hour, minute = int(clock.group(1)), int(clock.group(2) or 0)
    if clock.group(3) == "pm" and hour < 12:
        hour += 12
    if clock.group(3) == "am" and hour == 12:
        hour = 0
    when = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if when <= now:  # "18:00" when it's already 19:00 means tomorrow
        when += timedelta(days=1)
    return when.timestamp()


def describe(item, now=None):
    """'in 25 min', 'today 18:00', 'tomorrow 09:00', 'daily 09:00', or ''."""
    at = item.get("remind_at")
    if not at:
        return ""
    now = now or time.time()
    when = datetime.fromtimestamp(at)
    clock = when.strftime("%H:%M")
    repeat = item.get("repeat", "none")
    if repeat == "daily":
        return f"daily {clock}"
    if repeat == "weekly":
        return f"{when.strftime('%a')}s {clock}"
    delta = at - now
    if 0 < delta < 3600:
        return f"in {max(1, round(delta / 60))} min"
    today = datetime.fromtimestamp(now).date()
    if when.date() == today:
        return f"today {clock}"
    if when.date() == today + timedelta(days=1):
        return f"tomorrow {clock}"
    if delta < 0:
        return f"was {when.strftime('%d %b %H:%M')}"
    return when.strftime("%a %d %b %H:%M")


def latest_occurrence(item, now):
    """The most recent time this reminder was due, or None if not yet."""
    at = item.get("remind_at")
    if not at or at > now:
        return None
    period = REPEATS.get(item.get("repeat", "none"))
    if not period:
        return at
    return at + ((now - at) // period) * period


# ---------------------------------------------------------------- checking
def _notify(kind, item):
    """Show a notification with Open / Snooze buttons; act on the click.
    Runs detached so the checker can finish while the notification waits."""
    title = "⏰ " + (item.get("title") or item.get("text") or "Reminder").strip().splitlines()[0][:80]
    body = "Task" if kind == "tasks" else (item.get("body", "").strip()[:160] or "Note")
    bin_dir = Path.home() / ".local/bin"
    script = (
        'a=$(notify-send -a "Reminders" -u critical -i alarm-symbolic '
        '-A open="Open" -A snooze="Snooze 10 min" --wait "$1" "$2"); '
        'case "$a" in open) "$3/mk-companion" "$4" "$5";; '
        'snooze) "$3/mk-reminders" snooze "$5" 600;; esac'
    )
    if shutil.which("notify-send"):
        subprocess.Popen(["sh", "-c", script, "sh", title, body, str(bin_dir),
                          "note" if kind == "notes" else "tasks", item["id"]],
                         start_new_session=True, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)


def snooze(item_id, seconds):
    state = _read(STATE, {})
    state.setdefault("snooze", {})[item_id] = time.time() + seconds
    _write(STATE, state)


def check(now=None, notify=_notify):
    """Fire every reminder that's due. Returns how many fired."""
    now = now or time.time()
    data = load()
    state = _read(STATE, {})
    fired = state.setdefault("fired", {})
    snoozed = state.setdefault("snooze", {})
    count = 0
    for kind in ("notes", "tasks"):
        for item in data[kind]:
            if kind == "tasks" and item.get("done"):
                continue
            due = latest_occurrence(item, now)
            if due and due > fired.get(item["id"], 0):
                fired[item["id"]] = due
                if now - due < STALE_AFTER:
                    notify(kind, item)
                    count += 1
            wake = snoozed.get(item["id"])
            if wake and wake <= now:
                del snoozed[item["id"]]
                notify(kind, item)
                count += 1
    known = {i["id"] for k in ("notes", "tasks") for i in data[k]}
    state["fired"] = {k: v for k, v in fired.items() if k in known}
    state["snooze"] = {k: v for k, v in snoozed.items() if k in known}
    _write(STATE, state)
    return count

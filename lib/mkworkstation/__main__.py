"""python3 -m mkworkstation <command>

  apply-shortcuts           apply config/shortcuts.conf plus your changes
  brand                     print the name and short tag
  note TEXT [WHEN]          add a Companion note (first line is the title)
  task TEXT [WHEN]          add a Companion task
  list                      print notes, tasks and reminders
  device                    what this computer has and what MK does about it
WHEN: 30m, 2h, 1h30m, 18:00, 6pm, tomorrow, 'tomorrow 9:00'
"""
import sys

import mkworkstation
from mkworkstation import companion


def _add(kind, args):
    if not args:
        raise SystemExit(f"Usage: mk {kind[:-1]} \"text\" [when]")
    text = args[0].strip()
    when = companion.parse_when(" ".join(args[1:])) if len(args) > 1 else None
    if kind == "notes":
        title, _, body = text.partition("\n")
        item = companion.new_note(title.strip(), body.strip())
    else:
        item = companion.new_task(text)
    item["remind_at"] = when
    companion.add(kind, item)
    extra = f", reminder {companion.describe(item)}" if when else ""
    print(f"✔ Added {kind[:-1]}: {text.splitlines()[0][:60]}{extra}")


def _list():
    data = companion.load()
    for kind, field in (("notes", "title"), ("tasks", "text")):
        print(kind.upper())
        for item in data[kind]:
            mark = "[x]" if item.get("done") else ("[ ]" if kind == "tasks" else " - ")
            pin = "📌 " if item.get("pinned") else ""
            when = companion.describe(item)
            label = (item.get(field) or item.get("body", "")).strip().splitlines()
            print(f"  {mark} {pin}{label[0][:70] if label else 'Untitled'}"
                  + (f"   ⏰ {when}" if when else ""))


if __name__ == "__main__":
    command, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    try:
        if command == "apply-shortcuts":
            mkworkstation.apply_all(verbose=True)
        elif command == "brand":
            print("\t".join(mkworkstation.brand()))
        elif command in ("note", "task"):
            _add(command + "s", args)
        elif command == "list":
            _list()
        elif command == "device":
            from mkworkstation import device
            print(device.report())
        else:
            print(__doc__.strip(), file=sys.stderr)
            sys.exit(2)
    except ValueError as error:
        print(f"[-] {error}", file=sys.stderr)
        sys.exit(2)

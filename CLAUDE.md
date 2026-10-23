# Fedora MK Workstation – rules for Claude Code

## Project
Zero-touch IaC suite that turns stock Fedora Workstation (GNOME, Wayland) into the MK Workstation.
Key files: setup.sh (root installer; runs sync.sh as the user), sync.sh (single source of all GNOME settings),
register-face.sh (Howdy enrollment), scripts/update-repo.sh (`mk export`: dumps settings to config/),
extensions/mk-indicator@mehulk (top-bar watermark). User-facing docs: README.md, GUIDE.md.

## Rules
- Never run sudo, setup.sh, register-face.sh, or anything touching /etc. I run those myself.
- Never run git reset, git checkout -- <file>, or git restore without asking.
- Work on a branch and commit after each logical fix without asking; summarize the diff after committing.
- After editing any .sh file: run `bash -n <file>` and `shellcheck <file>`.
- All gsettings/dconf calls go through the as_user() helper (sets DBUS_SESSION_BUS_ADDRESS and XDG_RUNTIME_DIR).
- Scripts must be idempotent: safe to run twice with no duplicate lines.
- Back up any system file (PAM, dnf.conf, howdy config) before editing; never overwrite an existing .bak.
- Never commit browser secrets: logins.json, key4.db, cert9.db, cookies, sessionstore-backups/.
- Keep README claims matching what the code actually does.

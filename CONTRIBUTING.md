# Contributing

Thanks for helping. MK Workstation changes real systems (packages, PAM, GNOME settings), so every change follows a few rules.

## Ground rules

1. **Idempotent.** Running any script twice must give the same result: no duplicated lines, no repeated appends. Check before you change.
2. **Additive.** Never overwrite a user's lists (enabled extensions, custom shortcuts, mutter features). Use `gsettings_append` and the `mk-*` shortcut slots in `sync.sh`.
3. **Back up system files.** Before the first edit of anything in `/etc`, copy it to `<file>.bak`, and never overwrite an existing `.bak`.
4. **Right session.** Root scripts reach the desktop only through `as_user()` (it sets `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR` and `HOME`). Desktop settings belong in `sync.sh` and nowhere else.
5. **Fail visibly.** Don't hide errors with `|| true` or `2>/dev/null`. Optional steps add a line to `WARNINGS` so the user sees it at the end.
6. **Security first.** Never loosen authentication (Howdy `certainty`, PAM order) to make something "work". Never commit browser secrets; `.gitignore` covers the usual files.
7. **Docs match code.** If a change alters behaviour, update `README.md` and the matching file in `docs/` in the same pull request.

## Checks

```bash
sudo dnf install -y ShellCheck just
just check
```

This runs `bash -n` and ShellCheck on every shell script and a syntax check on the Python tools. GitHub Actions runs the same check on every push. When you add a script, add it to `scripts/lint.sh`.

Test desktop changes without touching your own settings by pointing dconf at a throwaway database:

```bash
printf 'user-db:mktest\n' > /tmp/mktest.profile
DCONF_PROFILE=/tmp/mktest.profile ./sync.sh   # run twice: the second run must change nothing
DCONF_PROFILE=/tmp/mktest.profile dconf reset -f /
```

## Where things go

| Change | File |
| :--- | :--- |
| A package or Flatpak | `apps/dnf-packages.txt` or `apps/flatpaks.txt` (check the name with `dnf repoquery` / `flatpak remote-info flathub <id>`) |
| A GNOME setting or shortcut | `sync.sh` |
| An extension or its settings | Enable and tune it, then `mk export` (writes `config/`) |
| A system-level step | `setup.sh` |
| Face unlock | `register-face.sh` |
| A desktop tool | `bin/` (plus `scripts/lint.sh` if it's a shell script) |

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) (`fix(face): …`, `feat(apps): …`, `docs: …`), one logical change per commit, and explain *why* in the body. Open pull requests against `main`.

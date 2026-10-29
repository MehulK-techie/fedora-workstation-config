# Security Policy

MK Workstation runs with root privileges (`setup.sh`, `register-face.sh`) and changes authentication (PAM for the login screen and `sudo`). Please report security problems privately.

## Reporting a vulnerability

Use GitHub's private reporting: **[Report a vulnerability](https://github.com/MehulK-techie/fedora-workstation-config/security/advisories/new)**. Please don't open a public issue for security problems.

Include what you ran, what happened, and your Fedora and GNOME versions. You should get a reply within a week.

## Supported versions

Only the latest commit on `main` is supported.

## Security-relevant behaviour

| Area | What MK does | Safeguard |
| :--- | :--- | :--- |
| PAM (`/etc/pam.d/gdm-password`, `/etc/pam.d/sudo`) | Adds `auth sufficient pam_howdy.so` as the first auth line | One-time `.bak` backup; skipped if `pam_howdy.so` is missing; your password always keeps working |
| Face unlock on a regular (RGB) webcam | Can be fooled by a photo | Matching is stricter than Howdy's default (`certainty 2.8`); Howdy has no liveness check, so a photo can still fool a regular webcam; `sudo` face unlock is opt-in and saying no removes it |
| Third-party repositories | RPM Fusion, the `principis/howdy` COPR, Microsoft's VS Code repo, Flathub | All signed; COPR is community-maintained, so skip it with `sudo ./setup.sh --no-face` if you don't want it |
| Extensions | Downloaded from extensions.gnome.org | Reviewed by GNOME; only WACK Shell is bundled (see [THIRD_PARTY.md](THIRD_PARTY.md)) |
| MK Notes phone sync | An HTTP server on your Wi-Fi address (port 8765) while Phone sync is on | Off by default. With PyNaCl (installed by setup.sh) every message both ways is encrypted (NaCl secretbox), each sealed reply names the exact request it answers, and once a phone has seen encryption it refuses plain replies and the laptop refuses plain uploads. Every request is signed with HMAC-SHA1 over the method, path, time and body hash; the pairing key never crosses the network, and requests can't be replayed. A pairing link must point at a private-network address, and replacing a pairing asks first. Without PyNaCl, notes travel unencrypted (signed): use it on trusted Wi-Fi. "New pairing key" unpairs every phone |
| PDF previews in MK Notes | Renders the first page of a PDF you embed | pdftoppm runs in a bubblewrap sandbox (no network, read-only system, only that file and a fresh empty folder); the result must be a regular file under 8 MB |
| Media tile | Shows album art a music player names | Web art is read up to 5 MB and only if the server says it's an image; only PNG/JPEG/WebP files are decoded; hidden and inert on the lock screen |
| Speed test | Contacts speed.cloudflare.com | Only when you click Run speed test in the monitor's menu |
| Screensaver | A full-screen window when you're idle | Not a lock: GNOME still locks at its own time (Settings › Privacy) |
| MK Notes reading view | Shows notes that may come from the phone, a shared vault or a download | Raw HTML in notes is never rendered. A nonce CSP allows only MK's script. Links can't point at `file:` URLs, and attachments that could run are shown in Files, never opened |
| Lock screen | Six extensions (animations, touchpad gestures, transparent top bar) stay loaded while locked, for a smoother unlock | Their gestures act only in `Shell.ActionMode.NORMAL`/`OVERVIEW`, never on the lock screen. The text grabber is not kept; MK's system monitor and top-bar items hide while locked, and its Super+V and Super+. answer only on the desktop. Screenshot keys (Print, the screenshot UI) are limited to the unlocked desktop by mk-indicator; the dock and Places menu are unloaded by GNOME while locked |
| Android app (`scripts/build-apk.sh`) | Builds and signs an APK with a key made on your computer | Random keystore password in `~/.local/share/mk-workstation/android-key.pass` (mode 600); the SDK licence is accepted by you, interactively |
| Login lockout | `pam_faillock` through authselect `with-faillock`: 5 wrong passwords within 15 minutes lock the account for 5 minutes | `/etc/security/faillock.conf` backed up once; the keys are rewritten, never duplicated; fingerprint still works; `faillock --user NAME --reset` (root) ends it early |
| Fingerprint on the lock screen | `scripts/fingerprint-pam.sh` comments out `pam_fprintd` in `gdm-password` (GNOME asks through `gdm-fingerprint`) | `gdm-password.bak` made once; lines are commented, not deleted |
| `mk lock app` | A launcher override that runs the app through `mk-lock run`, which asks polkit (`auth_self`: your fingerprint or password) first | A gate, not a vault: the program can still be started from a terminal, and an app already running isn't asked again |
| `mk lock PATH` | Encrypts the folder with gocryptfs; the random key is kept by root (`/usr/local/libexec/mk-lock-key`, `/var/lib/mk-lock/UID/`, 0600) | The key store runs only through pkexec after polkit `auth_self` (fingerprint or password, every time) and hands out only the caller's own keys, so other programs in your unlocked session can't open the folder. While it's open, anything running as you can read it; it closes when the screen locks. Moving files in is verified (`diff -r`) before the originals are removed. Back up `/var/lib/mk-lock` with the folder: without the key the files can't be recovered |
| Guest account (`mk guest on`) | An account named guest with no password and no admin rights; `pam_exec` in `gdm-password` empties its home at every login | `gdm-password.bak` made once; Every guest process is stopped and guest files in /tmp, /var/tmp and /dev/shm deleted before each wipe; logind ends guest processes at logout; cron and at are denied to the guest, a polkit rule stops it lingering, and the reset also clears any jobs or lingering; SSH refuses the guest (sshd drop-in, besides Fedora's `PermitEmptyPasswords no`). `mk guest off` removes the account and all of these. Empty passwords are allowed by Fedora's default authselect profile (only accounts without a password can use them); a local user could also `su guest`, which only gives them less access |
| Keyring after fingerprint or face login | GNOME can't unlock the login keyring without your password, so apps ask | MK changes nothing automatically; `mk keyring` explains the trade-off of an empty keyring password (secrets stored unencrypted) |
| App Nap | Freezes idle apps' systemd scopes under memory or CPU pressure | Only scopes named after the app (never a terminal's, which may hold other programs); thawed on focus, on disable and after a shell restart |
| `mk security` | A root helper (`/usr/local/libexec/mk-security-scan`) run through pkexec | Polkit asks for your fingerprint or password first. The scan only reads; fixes run only when named (`mk security fix NAME`). Report fields are stripped of separators and control characters, and only known fix commands are shown |
| Item passwords (`mk lock password`) | A folder's key sealed with a password of its own (Argon2id at its sensitive cost + NaCl secretbox), in `~/.local/share/mk-workstation/lock-items` (0600) | Weaker than the fingerprint check: whoever copies those files can guess passwords offline, so 10+ characters are required. For apps it is a gate only |
| Lock-screen scene | Frames rendered by `mk-screensaver` into `$XDG_RUNTIME_DIR` (private to you), shown behind the lock screen's clock | Display only: unlocking is untouched (GNOME's prompt). The renderer stops while the prompt is up and exits if the shell goes away |
| Emoji board | Commits text through GNOME's input method, or pastes with a virtual Ctrl+V | Only the emoji you picked, only into the window that had focus when you opened it |
| Clipboard history (Super+V) | Text and PNG copies kept in `~/.cache/mk-workstation/clipboard` (folder 0700), last 60 plus pinned | Copies from password managers, copies marked `x-kde-passwordManagerHint` and anything copied while locked are skipped; Clear removes all but pinned entries |
| In-app Face ID (`mk-face-auth`) | A root socket service that answers "is the face at the camera the caller's user?" for MK's apps | Only for the active local session's user (SO_PEERCRED); never checks passwords (no guessing oracle) and never releases a secret, so a yes only opens a gate (locked apps, MK Notes), never a folder key |
| Repository content | Exported settings | `mk export` strips home paths, history and machine IDs; `.gitignore` blocks browser secrets |

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
| Face unlock on a regular (RGB) webcam | Can be fooled by a photo | Matching stays at Howdy's strict default (`certainty 3.5`); `sudo` face unlock is opt-in and saying no removes it |
| Third-party repositories | RPM Fusion, the `principis/howdy` COPR, Microsoft's VS Code repo, Flathub | All signed; COPR is community-maintained, so skip it with `sudo ./setup.sh --no-face` if you don't want it |
| Extensions | Downloaded from extensions.gnome.org | Reviewed by GNOME; only WACK Shell is bundled (see [THIRD_PARTY.md](THIRD_PARTY.md)) |
| MK Notes phone sync | An HTTP server on your Wi-Fi address (port 8765) while Phone sync is on | Off by default. With PyNaCl (installed by setup.sh) every message both ways is encrypted (NaCl secretbox), each sealed reply names the exact request it answers, and once a phone has seen encryption it refuses plain replies and the laptop refuses plain uploads. Every request is signed with HMAC-SHA1 over the method, path, time and body hash; the pairing key never crosses the network, and requests can't be replayed. A pairing link must point at a private-network address, and replacing a pairing asks first. Without PyNaCl, notes travel unencrypted (signed): use it on trusted Wi-Fi. "New pairing key" unpairs every phone |
| PDF previews in MK Notes | Renders the first page of a PDF you embed | pdftoppm runs in a bubblewrap sandbox (no network, read-only system, only that file and a fresh empty folder); the result must be a regular file under 8 MB |
| Media tile | Shows album art a music player names | Web art is read up to 5 MB and only if the server says it's an image; only PNG/JPEG/WebP files are decoded; hidden and inert on the lock screen |
| Speed test | Contacts speed.cloudflare.com | Only when you click Run speed test in the monitor's menu |
| Screensaver | A full-screen window when you're idle | Not a lock: GNOME still locks at its own time (Settings › Privacy) |
| MK Notes reading view | Shows notes that may come from the phone, a shared vault or a download | Raw HTML in notes is never rendered. A nonce CSP allows only MK's script. Links can't point at `file:` URLs, and attachments that could run are shown in Files, never opened |
| Lock screen | Six extensions (animations, touchpad gestures, transparent top bar) stay loaded while locked, for a smoother unlock | Their gestures act only in `Shell.ActionMode.NORMAL`/`OVERVIEW`, never on the lock screen. The clipboard and text grabber are not kept; MK's system monitor hides while locked |
| Android app (`scripts/build-apk.sh`) | Builds and signs an APK with a key made on your computer | Random keystore password in `~/.local/share/mk-workstation/android-key.pass` (mode 600); the SDK licence is accepted by you, interactively |
| Login lockout | `pam_faillock` through authselect `with-faillock`: 5 wrong passwords within 15 minutes lock the account for 5 minutes | `/etc/security/faillock.conf` backed up once; the keys are rewritten, never duplicated; fingerprint still works; `faillock --user NAME --reset` (root) ends it early |
| Fingerprint on the lock screen | `scripts/fingerprint-pam.sh` comments out `pam_fprintd` in `gdm-password` (GNOME asks through `gdm-fingerprint`) | `gdm-password.bak` made once; lines are commented, not deleted |
| `mk lock app` | A launcher override that runs the app through `mk-lock run`, which asks polkit (`auth_self`: your fingerprint or password) first | A gate, not a vault: the program can still be started from a terminal, and an app already running isn't asked again |
| `mk lock PATH` | Encrypts the folder with gocryptfs; the random key is kept by root (`/usr/local/libexec/mk-lock-key`, `/var/lib/mk-lock/UID/`, 0600) | The key store runs only through pkexec after polkit `auth_self` (fingerprint or password, every time) and hands out only the caller's own keys, so other programs in your unlocked session can't open the folder. While it's open, anything running as you can read it; it closes when the screen locks. Moving files in is verified (`diff -r`) before the originals are removed. Back up `/var/lib/mk-lock` with the folder: without the key the files can't be recovered |
| Guest account (`mk guest on`) | An account named guest with no password and no admin rights; `pam_exec` in `gdm-password` empties its home at every login | `gdm-password.bak` made once; Every guest process is stopped and guest files in /tmp, /var/tmp and /dev/shm deleted before each wipe; logind ends guest processes at logout; cron and at are denied to the guest, a polkit rule stops it lingering, and the reset also clears any jobs or lingering; SSH refuses the guest (sshd drop-in, besides Fedora's `PermitEmptyPasswords no`). `mk guest off` removes the account and all of these. Empty passwords are allowed by Fedora's default authselect profile (only accounts without a password can use them); a local user could also `su guest`, which only gives them less access |
| Keyring after fingerprint or face login | GNOME can't unlock the login keyring without your password, so apps ask | MK changes nothing automatically; `mk keyring` explains the trade-off of an empty keyring password (secrets stored unencrypted) |
| App Nap | Freezes idle apps' systemd scopes under memory or CPU pressure | Only scopes named after the app (never a terminal's, which may hold other programs); thawed on focus, on disable and after a shell restart |
| Repository content | Exported settings | `mk export` strips home paths, history and machine IDs; `.gitignore` blocks browser secrets |

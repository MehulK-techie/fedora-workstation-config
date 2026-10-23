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
| MK Notes phone sync | An HTTP server on your Wi-Fi address (port 8765) while Phone sync is on | Off by default. Every request is signed with HMAC-SHA1 over the method, path, time and body hash; the pairing key never crosses the network, and requests can't be replayed. A pairing link must point at a private-network address, and replacing a pairing asks first. Notes travel **unencrypted**: use it on trusted Wi-Fi. "New pairing key" unpairs every phone |
| MK Notes reading view | Shows notes that may come from the phone, a shared vault or a download | Raw HTML in notes is never rendered. A nonce CSP allows only MK's script. Links can't point at `file:` URLs, and attachments that could run are shown in Files, never opened |
| Lock screen | Six extensions (animations, touchpad gestures, transparent top bar) stay loaded while locked, for a smoother unlock | Their gestures act only in `Shell.ActionMode.NORMAL`/`OVERVIEW`, never on the lock screen. The clipboard and text grabber are not kept; MK's system monitor hides while locked |
| Android app (`scripts/build-apk.sh`) | Builds and signs an APK with a key made on your computer | Random keystore password in `~/.local/share/mk-workstation/android-key.pass` (mode 600); the SDK licence is accepted by you, interactively |
| Repository content | Exported settings | `mk export` strips home paths, history and machine IDs; `.gitignore` blocks browser secrets |

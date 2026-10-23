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
| Repository content | Exported settings | `mk export` strips home paths, history and machine IDs; `.gitignore` blocks browser secrets |

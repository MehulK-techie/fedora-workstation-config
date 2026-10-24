#!/bin/bash
# Fingerprint on the login and lock screens (run as root; setup.sh runs it).
#
# GNOME asks for your finger through its own PAM service, gdm-fingerprint,
# alongside the password field (gdm-password). If gdm-password also uses the
# reader (pam_fprintd), the two ask at once, one gets "Device was already
# claimed", and the lock screen stops reacting to your finger. This script:
#   1. installs fprintd and fprintd-pam if they're missing
#   2. turns on authselect's with-fingerprint (sudo, polkit, gdm-fingerprint)
#   3. backs up gdm-password, then comments out any pam_fprintd line in it
#   4. checks that gdm-fingerprint exists
#   5. restarts fprintd so no old claim is left on the reader
# Safe to run again: backups are made once (never overwritten), and lines
# already commented out are left alone.
#
# Undo: sudo cp -a /etc/pam.d/gdm-password.bak /etc/pam.d/gdm-password
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run as root: sudo $0" >&2
    exit 1
fi

PAM_DIR=/etc/pam.d
WARN=()

backup() {
    [[ -f "$1" && ! -f "$1.bak" ]] && cp -a "$1" "$1.bak"
    return 0
}

if ! gdbus call --system --dest net.reactivated.Fprint \
        --object-path /net/reactivated/Fprint/Manager \
        --method net.reactivated.Fprint.Manager.GetDevices 2> /dev/null | grep -q 'Device/'; then
    echo "    No fingerprint reader found: nothing to do."
    exit 0
fi

missing=()
for pkg in fprintd fprintd-pam; do
    rpm -q "$pkg" &> /dev/null || missing+=("$pkg")
done
if (( ${#missing[@]} )); then
    dnf install -y "${missing[@]}" || WARN+=("Could not install: ${missing[*]}")
fi

if ! authselect current 2> /dev/null | grep -q with-fingerprint; then
    # -b: authselect backs up the files it manages first.
    authselect enable-feature -b with-fingerprint \
        || WARN+=("Could not enable with-fingerprint (authselect enable-feature with-fingerprint)")
fi

GDM_PASSWORD="$PAM_DIR/gdm-password"
if [[ -f "$GDM_PASSWORD" ]] && grep -qE '^[^#]*pam_fprintd' "$GDM_PASSWORD"; then
    backup "$GDM_PASSWORD"
    sed -i -E '/^[^#]*pam_fprintd/s/^/#MK (gdm-fingerprint uses the reader): /' "$GDM_PASSWORD"
    echo "    gdm-password: no longer claims the reader (backup: $GDM_PASSWORD.bak)"
fi

if [[ ! -f "$PAM_DIR/gdm-fingerprint" ]]; then
    WARN+=("$PAM_DIR/gdm-fingerprint is missing; restore it with: sudo dnf reinstall gdm")
fi

systemctl try-restart fprintd.service 2> /dev/null || true

if (( ${#WARN[@]} )); then
    printf '    ! %s\n' "${WARN[@]}"
    exit 1
fi
echo "    Fingerprint login and lock screen ready. Enroll a finger with: mk fingerprint"

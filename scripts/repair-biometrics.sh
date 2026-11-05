#!/usr/bin/env bash
# Fingerprint (and face) unlock after a Fedora upgrade: check and repair.
#
#   sudo ./scripts/repair-biometrics.sh
#
# What it does, only where something is actually wrong:
#   1. fingerprint PAM: authselect's with-fingerprint (sudo, polkit, the lock
#      screen's gdm-fingerprint) and the fprintd service
#   2. Howdy left behind: when an upgrade removed Howdy (Fedora 45 does), sudo
#      and polkit still name pam_howdy.so, a module that's gone; those lines
#      are taken out (a backup of each file first) so every prompt stops
#      logging "PAM adding faulty module". register-face.sh puts them back
#      once Howdy is installed again.
#   3. a check that the reader answers and has a finger enrolled for you
#
# What it doesn't touch: GDM's own files. GNOME asks for a finger through its
# gdm-fingerprint service, alongside the password field (gdm-password), and
# both ship in /usr/lib/pam.d on Fedora 45. Adding pam_fprintd to
# gdm-password as well would make the password field wait for the reader
# (scripts/fingerprint-pam.sh deliberately keeps it out).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run it with sudo: sudo $0" >&2
    exit 1
fi
USER_NAME=${SUDO_USER:-}
WARN=()

# a backup next to FILE, never over an existing one (.bak, then .bak-YYYYmmdd-HHMMSS)
backup() {
    local f=$1 b="$1.bak"
    [[ -e "$b" ]] && b="$1.bak-$(date +%Y%m%d-%H%M%S)"
    cp -a "$f" "$b"
    echo "    (backup: $b)"
}

echo "==> 1/3 Fingerprint sign-in"
if ! authselect current 2> /dev/null | grep -q with-fingerprint; then
    authselect enable-feature -b with-fingerprint \
        || WARN+=("authselect couldn't enable with-fingerprint")
    echo "    [+] with-fingerprint enabled"
else
    echo "    [ok] authselect: with-fingerprint is on"
fi
if [[ ! -f /etc/pam.d/gdm-fingerprint && ! -f /usr/lib/pam.d/gdm-fingerprint ]]; then
    WARN+=("gdm-fingerprint is missing: sudo dnf reinstall gdm")
else
    echo "    [ok] GDM's fingerprint service is present"
fi
# fprintd starts on demand (D-Bus); "enabled" here means nothing has masked it
if systemctl is-enabled fprintd.service 2> /dev/null | grep -q masked; then
    systemctl unmask fprintd.service
    echo "    [+] fprintd was masked: unmasked"
fi
systemctl try-restart fprintd.service 2> /dev/null || true

echo "==> 2/3 Howdy leftovers"
if [[ -e /usr/lib64/security/pam_howdy.so || -e /usr/lib/security/pam_howdy.so ]]; then
    echo "    [ok] Howdy is installed; its PAM lines stay"
else
    for pam in /etc/pam.d/sudo /etc/pam.d/polkit-1 /etc/pam.d/gdm-password /etc/pam.d/login; do
        if [[ -f "$pam" ]] && grep -qE '^[[:space:]]*auth[[:space:]].*pam_howdy\.so' "$pam"; then
            backup "$pam"
            sed -i -E '/^[[:space:]]*auth[[:space:]].*pam_howdy\.so/d' "$pam"
            echo "    [+] ${pam##*/}: removed pam_howdy.so (the module is gone)"
        fi
    done
    echo "    Howdy isn't installed (Fedora 45 removed it); see docs/FACE-UNLOCK.md"
fi

echo "==> 3/3 The reader"
if [[ -n "$USER_NAME" ]] && command -v fprintd-list > /dev/null; then
    out=$(fprintd-list "$USER_NAME" 2>&1 || true)
    if grep -q '#[0-9]' <<< "$out"; then
        echo "    [ok] $(grep -m1 'Fingerprints for' <<< "$out")"
        grep -E '^ - #' <<< "$out" | sed 's/^/      /'
    elif grep -qi 'no devices' <<< "$out"; then
        WARN+=("No fingerprint reader found (a driver may be missing after the upgrade)")
    else
        WARN+=("No finger enrolled for $USER_NAME: run 'mk fingerprint'")
    fi
fi

if (( ${#WARN[@]} )); then
    printf '    ! %s\n' "${WARN[@]}"
    exit 1
fi
cat << 'DONE'
✔ Fingerprint unlock is set up. To check it: lock the screen (Super+L), and
  with the password field showing, touch the reader. GNOME 51 doesn't say
  "place your finger" in advance on a touch reader: a touch is enough.
DONE

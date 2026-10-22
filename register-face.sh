#!/usr/bin/env bash
set -euo pipefail

echo "================================================="
echo "   MK Workstation - Howdy Face Scan Setup       "
echo "================================================="

if [[ $EUID -ne 0 ]]; then
    echo "[-] Error: register-face.sh must be run with sudo." >&2
    exit 1
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
echo "[+] Enrolling face model for user: ${REAL_USER}"

PAM_FILES=(/etc/pam.d/gdm-password /etc/pam.d/sudo)
HOWDY_LINE="auth        sufficient    pam_howdy.so"

HOWDY_CONF=""
for cfg in "/etc/howdy/config.ini" "/usr/lib64/security/howdy/config.ini"; do
    if [[ -f "$cfg" ]]; then
        HOWDY_CONF="$cfg"
        break
    fi
done

if [[ -z "$HOWDY_CONF" ]]; then
    echo "[-] Error: Howdy config file not found. Ensure howdy is installed." >&2
    exit 1
fi

echo "==> Detected video capture devices:"
v4l2-ctl --list-devices 2>/dev/null || ls -l /dev/video* 2>/dev/null

DEFAULT_CAM="/dev/video0"
read -rp "Enter camera device path [press Enter for $DEFAULT_CAM]: " SELECTED_CAM
SELECTED_CAM="${SELECTED_CAM:-$DEFAULT_CAM}"

[ -f "${HOWDY_CONF}.bak" ] || cp -a "$HOWDY_CONF" "${HOWDY_CONF}.bak"
sed -i -E "s|^[[:space:]]*device_path[[:space:]]*=.*|device_path = ${SELECTED_CAM}|" "$HOWDY_CONF"
echo "[+] Configured ${HOWDY_CONF} -> device_path = ${SELECTED_CAM}"

echo "==> Starting Face Scan Registration for ${REAL_USER}..."
howdy -U "${REAL_USER}" add

echo "==> Enabling Howdy in PAM (gdm-password, sudo)..."
if [[ ! -e /usr/lib64/security/pam_howdy.so ]] && [[ ! -e /usr/lib/security/pam_howdy.so ]]; then
    echo "⚠ pam_howdy.so not found — skipping PAM changes to prevent lockout."
else
    for pam in "${PAM_FILES[@]}"; do
        if [[ ! -f "$pam" ]]; then
            echo "    $pam not present, skipping."
            continue
        fi

        [ -f "${pam}.bak" ] || cp -a "$pam" "${pam}.bak"
        sed -i -E '/^[[:space:]]*auth[[:space:]].*pam_python\.so.*howdy/d' "$pam"

        if ! grep -qE '^[[:space:]]*auth[[:space:]].*pam_howdy\.so' "$pam"; then
            sed -i "0,/^[[:space:]]*auth/s//${HOWDY_LINE}\n&/" "$pam"
            echo "    [+] ${pam} updated with pam_howdy.so."
        else
            echo "    [*] ${pam} already contains pam_howdy.so."
        fi
    done
fi

if command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
    setsebool -P authlogin_camera 1 2>/dev/null || true
fi

echo "==> Testing Face Recognition..."
howdy -U "${REAL_USER}" test || true

echo "================================================="
echo "✔ Facial recognition setup complete for ${REAL_USER}!"
echo "================================================="

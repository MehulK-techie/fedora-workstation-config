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

if ! command -v v4l2-ctl &>/dev/null; then
    echo "[-] Error: v4l2-ctl not found. Install it with: sudo dnf install v4l-utils" >&2
    exit 1
fi

# Sort capture nodes into IR and RGB. Metadata nodes (no VIDEO_CAPTURE cap)
# are skipped. A node counts as IR if it offers greyscale formats or its name
# says IR/infrared.
echo "==> Scanning video capture devices..."
IR_CAMS=()
RGB_CAMS=()
declare -A CAM_NAME
for dev in /dev/video*; do
    [[ -e "$dev" ]] || continue
    info=$(v4l2-ctl -d "$dev" --info 2>/dev/null) || continue
    caps=$(awk -F: '/Device Caps/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' <<< "$info")
    if [[ -z "$caps" ]] || ! (( caps & 0x1 )); then
        continue
    fi
    CAM_NAME[$dev]=$(awk -F': ' '/Card type/ { print $2; exit }' <<< "$info")
    formats=$(v4l2-ctl -d "$dev" --list-formats 2>/dev/null || true)
    if grep -qE "'(GREY|Y8  |Y10 |Y16 )'" <<< "$formats" \
        || grep -qiE '(^|[^[:alpha:]])(ir|infrared)([^[:alpha:]]|$)' <<< "${CAM_NAME[$dev]}"; then
        IR_CAMS+=("$dev")
    else
        RGB_CAMS+=("$dev")
    fi
done

if (( ${#IR_CAMS[@]} )); then
    CANDIDATES=("${IR_CAMS[@]}")
    echo "[+] Found ${#IR_CAMS[@]} IR camera(s)."
elif (( ${#RGB_CAMS[@]} )); then
    CANDIDATES=("${RGB_CAMS[@]}")
    echo "⚠ No IR camera found. Falling back to a regular camera; a printed photo"
    echo "  may be enough to fool Howdy without IR, so keep your password strong."
else
    echo "[-] Error: No video capture device found." >&2
    exit 1
fi

if (( ${#CANDIDATES[@]} == 1 )); then
    SELECTED_CAM="${CANDIDATES[0]}"
else
    echo "==> Several cameras found:"
    for i in "${!CANDIDATES[@]}"; do
        printf '    %d) %s  (%s)\n' "$((i + 1))" "${CANDIDATES[$i]}" "${CAM_NAME[${CANDIDATES[$i]}]}"
    done
    while true; do
        choice=""
        read -rp "Select camera [1-${#CANDIDATES[@]}, Enter for 1]: " choice || true
        choice="${choice:-1}"
        if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#CANDIDATES[@]} )); then
            SELECTED_CAM="${CANDIDATES[$((choice - 1))]}"
            break
        fi
        echo "    Invalid choice: $choice"
    done
fi
echo "[+] Using camera: ${SELECTED_CAM} (${CAM_NAME[$SELECTED_CAM]})"

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

        has_howdy=0 has_stale=0
        grep -qE '^[[:space:]]*auth[[:space:]].*pam_howdy\.so' "$pam" && has_howdy=1
        grep -qE '^[[:space:]]*auth[[:space:]].*pam_python\.so.*howdy' "$pam" && has_stale=1

        if (( has_howdy && !has_stale )); then
            echo "    [*] ${pam} already contains pam_howdy.so."
            continue
        fi

        # Keep the pristine original; never overwrite an existing backup.
        [ -f "${pam}.bak" ] || cp -a "$pam" "${pam}.bak"
        # Drop stale Howdy 2.x hooks (pam_python + howdy/pam.py); 3.x replaces them.
        sed -i -E '/^[[:space:]]*auth[[:space:]].*pam_python\.so.*howdy/d' "$pam"

        if (( !has_howdy )); then
            # Insert before the first auth line so face auth is tried first.
            sed -i "0,/^[[:space:]]*auth/s//${HOWDY_LINE}\n&/" "$pam"
            echo "    [+] ${pam} updated with pam_howdy.so (backup: ${pam}.bak)."
        else
            echo "    [+] ${pam} cleaned of stale Howdy 2.x line (backup: ${pam}.bak)."
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

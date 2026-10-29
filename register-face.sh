#!/usr/bin/env bash
# ==============================================================================
# MK Workstation: Howdy Face Unlock Wizard
# ==============================================================================
set -euo pipefail

usage() {
    cat << 'EOF'
Usage: sudo ./register-face.sh [--user NAME] [--models N] [--tune-only]

Sets up face unlock in a few guided steps: picks the best camera, tunes Howdy
for it, records up to N face models in different lighting (so unlock keeps
working in a dim room or by a bright window), then enables it for the login
screen and sudo (on a regular webcam, sudo only if you say yes). Your password
always keeps working. Safe to run again.

  --user NAME  Enroll another account on this computer (default: you)
  --models N   How many face models to record, 1-5 (default: 3)
  --tune-only  Re-detect the camera and re-tune Howdy without recording faces
  -h, --help   Show this help
EOF
}

TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
MODEL_COUNT=3
TUNE_ONLY=0
while (( $# )); do
    case "$1" in
        --user) TARGET_USER="${2:?--user needs a name}"; shift ;;
        --models) MODEL_COUNT="${2:?--models needs a number}"; shift ;;
        --tune-only) TUNE_ONLY=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[-] Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

if [[ ! "$MODEL_COUNT" =~ ^[1-5]$ ]]; then
    echo "[-] Error: --models must be a number from 1 to 5." >&2
    exit 2
fi
if [[ $EUID -ne 0 ]]; then
    echo "[-] Error: register-face.sh must be run with sudo." >&2
    exit 1
fi
if ! id "$TARGET_USER" &>/dev/null || [[ "$TARGET_USER" == "root" ]]; then
    echo "[-] Error: '$TARGET_USER' is not a desktop user on this computer." >&2
    exit 1
fi
if ! command -v howdy &>/dev/null; then
    echo "[-] Error: Howdy isn't installed. Run sudo ./setup.sh first." >&2
    exit 1
fi
if ! command -v v4l2-ctl &>/dev/null; then
    echo "[-] Error: v4l2-ctl not found. Install it with: sudo dnf install v4l-utils" >&2
    exit 1
fi

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

PAM_FILES=(/etc/pam.d/gdm-password /etc/pam.d/sudo /etc/pam.d/polkit-1)
HOWDY_LINE="auth        sufficient    pam_howdy.so"

# Set one key in Howdy's config (keys are unique across its sections).
set_howdy() {
    sed -i -E "s|^[[:space:]]*$1[[:space:]]*=.*|$1 = $2|" "$HOWDY_CONF"
}

# Average brightness (0-255) of the camera picture, or empty if it can't be read.
measure_light() {
    command -v ffmpeg &>/dev/null || return 0
    timeout 15 ffmpeg -hide_banner -loglevel error -f v4l2 -i "$1" \
        -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" \
        -frames:v 10 -f null - 2>/dev/null \
        | grep -oE 'YAVG=[0-9]+' | tail -n 1 | cut -d= -f2 || true
}

# Another program holding the camera makes Howdy wait forever: name it, and
# offer to close it (it's asked first: it may be a call you're in).
camera_free() {
    local holders pids
    command -v fuser &>/dev/null || return 0
    pids=$(fuser "$1" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)
    [[ -z "$pids" ]] && return 0
    holders=$(for p in $pids; do printf '%s (%s) ' "$(ps -o comm= -p "$p" 2>/dev/null)" "$p"; done)
    echo "  ⚠ The camera is in use by: $holders"
    local close=""
    read -rp "  Close them now? [y/N]: " close || true
    if [[ "$close" =~ ^[yY] ]]; then
        # shellcheck disable=SC2086 # one pid per word
        kill $pids 2>/dev/null || true
        sleep 1
    fi
}

describe_light() {
    local level=$1
    if [[ -z "$level" ]]; then
        echo "couldn't measure"
    elif (( level < 40 )); then
        echo "$level/255, too dark: turn on a light facing you"
    elif (( level < 70 )); then
        echo "$level/255, dim"
    elif (( level <= 190 )); then
        echo "$level/255, good"
    else
        echo "$level/255, very bright: avoid a window or lamp behind you"
    fi
}

echo "================================================="
echo "   MK Workstation - Face Unlock Setup            "
echo "================================================="
echo "[+] Account: ${TARGET_USER}"

# ------------------------------------------------------------------------------
# Step 1: Find the camera. IR cameras (Windows Hello type) work in the dark and
# can't be fooled by a photo, so they always win over regular webcams.
# ------------------------------------------------------------------------------
echo "==> Step 1/4: Finding your camera..."
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
    CAM_TYPE="ir"
    CANDIDATES=("${IR_CAMS[@]}")
    echo "[+] Found ${#IR_CAMS[@]} IR camera(s)."
elif (( ${#RGB_CAMS[@]} )); then
    CAM_TYPE="rgb"
    CANDIDATES=("${RGB_CAMS[@]}")
    echo "⚠ No IR camera found, only a regular webcam. It needs good light facing you,"
    echo "  and a printed photo may be enough to fool it, so keep a strong password."
    answer=y
    (( TUNE_ONLY )) || read -rp "  Use the regular webcam for face unlock anyway? [y/N]: " answer || true
    if [[ ! "$answer" =~ ^[yY] ]]; then
        echo "[*] Face unlock not set up. Nothing was changed. Your password works as always."
        if command -v fprintd-enroll &>/dev/null && fprintd-list "$TARGET_USER" 2>/dev/null | grep -qi 'device at'; then
            echo "    This laptop has a fingerprint reader: mk fingerprint enroll"
        fi
        exit 0
    fi
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

# /dev/videoN can renumber after a reboot or when another camera is plugged
# in; the udev links under /dev/v4l name this camera itself.
HOWDY_DEVICE="$SELECTED_CAM"
for link in /dev/v4l/by-id/* /dev/v4l/by-path/*; do
    if [[ -e "$link" && "$(readlink -f "$link")" == "$SELECTED_CAM" ]]; then
        HOWDY_DEVICE="$link"
        break
    fi
done

# ------------------------------------------------------------------------------
# Step 2: Tune Howdy for this camera. Howdy skips frames darker than
# dark_threshold and accepts a match below certainty/10 (lower = stricter).
# Matching stays at Howdy's strict default for every camera: accuracy comes
# from the extra lighting models, never from accepting weaker matches.
# Regular webcams see mostly-dark frames in a dim room, so they get a higher
# dark_threshold and a little more time to find a usable frame. (Howdy skips a
# frame when its share of dark pixels is ABOVE dark_threshold: lowering it
# rejects more night frames, never fewer.)
# ------------------------------------------------------------------------------
echo "==> Step 2/4: Tuning face recognition for this camera..."
[[ -f "${HOWDY_CONF}.bak" ]] || cp -a "$HOWDY_CONF" "${HOWDY_CONF}.bak"
set_howdy device_path "$HOWDY_DEVICE"
set_howdy certainty 2.8  # stricter than Howdy's 3.5: fewer look-alikes or photos get in
if [[ "$CAM_TYPE" == "ir" ]]; then
    set_howdy dark_threshold 60
    set_howdy timeout 3
else
    set_howdy dark_threshold 80
    set_howdy timeout 4
fi
set_howdy abort_if_ssh true
set_howdy abort_if_lid_closed true
echo "[+] ${HOWDY_CONF}: $(grep -E '^(device_path|certainty|dark_threshold|timeout) ' "$HOWDY_CONF" | tr '\n' ' ')"

# Let the camera adapt its exposure to the room instead of a fixed setting.
if v4l2-ctl -d "$SELECTED_CAM" --list-ctrls-menus 2>/dev/null | grep -q 'auto_exposure'; then
    if v4l2-ctl -d "$SELECTED_CAM" --list-ctrls-menus | grep -qE '^[[:space:]]+3: Aperture Priority Mode'; then
        v4l2-ctl -d "$SELECTED_CAM" --set-ctrl=auto_exposure=3 2>/dev/null || true
    fi
fi

# A regular webcam can be fooled by a photo, and sudo grants full control of
# the computer, so on RGB cameras sudo face unlock is opt-in. Answering no
# also removes it if an earlier run (or an IR camera) had enabled it.
SUDO_FACE=1
sudo_has_howdy() {
    grep -qE '^[[:space:]]*auth[[:space:]].*pam_howdy\.so' /etc/pam.d/sudo 2>/dev/null
}
if [[ "$CAM_TYPE" == "rgb" ]] && { (( !TUNE_ONLY )) || sudo_has_howdy; }; then
    answer=""
    read -rp "  Use face unlock for sudo and system prompts (admin commands, Vault, MK Lock)? A photo of you could pass. [y/N]: " answer || true
    if [[ ! "$answer" =~ ^[yY] ]]; then
        SUDO_FACE=0
        for pam in /etc/pam.d/sudo /etc/pam.d/polkit-1; do
            if grep -qE '^[[:space:]]*auth[[:space:]].*pam_howdy\.so' "$pam" 2>/dev/null; then
                [[ -f "$pam.bak" ]] || cp -a "$pam" "$pam.bak"
                sed -i -E '/^[[:space:]]*auth[[:space:]].*pam_howdy\.so/d' "$pam"
                echo "    [+] Removed face unlock from ${pam##*/}; it now asks for your password."
            fi
        done
    fi
fi

if (( TUNE_ONLY )); then
    echo "✔ Re-tuned Howdy for ${HOWDY_DEVICE}. No face models were changed."
    exit 0
fi

# ------------------------------------------------------------------------------
# Step 3: Record face models in different lighting. Howdy compares against
# every model, so one per lighting condition is what makes unlock reliable.
# ------------------------------------------------------------------------------
echo "==> Step 3/4: Recording your face..."
EXISTING=$(howdy -U "$TARGET_USER" --plain list 2>/dev/null | grep -cE '^[0-9]+' || true)
if (( EXISTING > 0 )); then
    echo "[*] ${TARGET_USER} already has ${EXISTING} face model(s). New ones are added alongside them."
    echo "    (To start over: sudo howdy -U ${TARGET_USER} clear)"
fi

SCENES=(
    "Normal light|Sit the way you usually do, in your normal room light."
    "Dim light|Dim the room: switch off the main light or close the curtains."
    "Bright or side light|Sit near a window or lamp, or put on glasses if you wear them."
    "Different angle|Lean back a little or tilt your head slightly."
    "Extra condition|Any other look you often have (hat, headphones, makeup)."
)
recorded=0
for (( i = 0; i < MODEL_COUNT; i++ )); do
    label="${SCENES[$i]%%|*}"
    tip="${SCENES[$i]#*|}"
    # Never two models with one name: an existing one is kept as it is.
    if howdy -U "$TARGET_USER" --plain list 2> /dev/null | awk -F, -v want="$label" '$3 == want { found = 1 } END { exit !found }'; then
        echo ""
        echo "  Face model \"${label}\" is already recorded: kept (remove it with: sudo howdy -U ${TARGET_USER} remove ID)."
        continue
    fi
    echo ""
    echo "  Face model $((i + 1)) of ${MODEL_COUNT}: ${label}"
    echo "  ${tip}"
    # Free the camera first: a browser or call holding it is why the light
    # "couldn't measure" and why Howdy would wait for ever.
    camera_free "$SELECTED_CAM"
    if [[ "$CAM_TYPE" == "rgb" ]]; then
        echo "  Light at the camera: $(describe_light "$(measure_light "$SELECTED_CAM")")"
    fi
    answer=""
    read -rp "  Press Enter when ready and look at the camera (s = skip, q = finish): " answer || true
    case "$answer" in
        s|S) continue ;;
        q|Q) break ;;
    esac
    camera_free "$SELECTED_CAM"
    # Howdy gives up after 60 frames, but a camera another program holds can
    # block it for good: never wait more than 30 s. --foreground keeps it on
    # this terminal, so nothing it prints or asks is swallowed.
    echo "  Recording (up to 30 s): keep looking at the camera…"
    status=0
    timeout --foreground 30 howdy -y -U "$TARGET_USER" add "$label" || status=$?
    if (( status == 0 )); then
        recorded=$((recorded + 1))
    elif (( status == 124 )); then
        echo "  ⚠ The camera didn't answer in 30 s. Close apps that may use it (browser, Photo Booth) and try again."
    else
        echo "  ⚠ That one didn't work (no face found?). Face the light, not a window behind you, and try again."
    fi
done

if (( recorded == 0 && EXISTING == 0 )); then
    echo "[-] No face model was recorded, so face unlock was not enabled." >&2
    exit 1
fi
echo "[+] Recorded ${recorded} new face model(s) for ${TARGET_USER}."

# ------------------------------------------------------------------------------
# Step 4: Turn on face unlock for the login screen, sudo and system prompts.
# ------------------------------------------------------------------------------
echo "==> Step 4/4: Enabling face unlock..."
(( SUDO_FACE )) || PAM_FILES=(/etc/pam.d/gdm-password)
# polkit's PAM stack (GNOME's "confirm it's you" prompt: Vault, MK Lock, admin
# tasks) ships in /usr/lib/pam.d; a copy in /etc/pam.d takes its place.
if (( SUDO_FACE )) && [[ ! -f /etc/pam.d/polkit-1 && -f /usr/lib/pam.d/polkit-1 ]]; then
    cp -a /usr/lib/pam.d/polkit-1 /etc/pam.d/polkit-1
fi
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

echo ""
echo "================================================="
echo "✔ Face unlock is ready for ${TARGET_USER}!"
echo "================================================="
echo "  Try it:        sudo -k; sudo true      (look at the camera)"
echo "  Your models:   sudo howdy -U ${TARGET_USER} list"
echo "  Add more:      sudo ./register-face.sh --models 1"
echo "  Another user:  sudo ./register-face.sh --user NAME"
echo "  Pause it:      sudo howdy disable 1   (0 turns it back on)"

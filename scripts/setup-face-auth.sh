#!/usr/bin/env bash
# Face unlock on Fedora 45 without Howdy: MK's own OpenCV check (YuNet +
# SFace, python3-opencv), for sudo, the lock screen and MK's apps.
#
#   sudo ./scripts/setup-face-auth.sh             install, enroll, then ask where to use it
#   sudo ./scripts/setup-face-auth.sh --remove    take face out of every PAM file again
#
# What it does:
#   1. installs the engine to /usr/local/libexec/mk-face
#   2. downloads its two models from OpenCV's model zoo into
#      /usr/local/share/mk-face, checked against pinned SHA-256 sums
#   3. records your face (mk-face enroll: ~6 s at the camera)
#   4. MK's apps (MK Notes' lock, the unlock dialog): /etc/pam.d/mk-auth asks it
#   5. asks, one at a time, before adding it to sudo and to the lock screen
#      (/etc/pam.d/gdm-password, copied from /usr/lib/pam.d first when missing)
# Every PAM file is backed up first (.bak, never over an existing one). The
# line is "auth sufficient pam_exec.so quiet ... mk-face --pam": a match lets
# you in, anything else falls through to the password, which always works.
#
# Know the limit: an ordinary webcam can't tell your face from a good photo
# of it. Face is a convenience; keep a strong password.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $EUID -ne 0 ]]; then
    echo "Run it with sudo: sudo $0" >&2
    exit 1
fi
USER_NAME=${SUDO_USER:-}
ENGINE=/usr/local/libexec/mk-face
MODEL_DIR=/usr/local/share/mk-face
PAM_LINE="auth       sufficient   pam_exec.so quiet $ENGINE --pam"
ZOO=https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models
MODELS=(
    "face_detection_yunet/face_detection_yunet_2023mar.onnx 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
    "face_recognition_sface/face_recognition_sface_2021dec.onnx 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
)

# a backup next to FILE, never over an existing one (.bak, then .bak-YYYYmmdd-HHMMSS)
backup() {
    local f=$1 b="$1.bak"
    [[ -e "$f" ]] || return 0
    [[ -e "$b" ]] && b="$f.bak-$(date +%Y%m%d-%H%M%S)"
    cp -a "$f" "$b"
    echo "    backup: $b"
}

add_line() {           # FILE: the face line before the first auth line, once
    local f=$1
    if grep -qF "mk-face --pam" "$f"; then
        echo "  [=] $f already uses face"
        return
    fi
    backup "$f"
    awk -v line="$PAM_LINE" '!done && /^[[:space:]]*-?auth[[:space:]]/ { print line; done=1 } { print }' "$f" > "$f.mk-tmp"
    cat "$f.mk-tmp" > "$f"
    rm -f "$f.mk-tmp"
    echo "  [+] $f: face first, then the password"
}

remove_line() {
    local f=$1
    grep -qF "mk-face --pam" "$f" 2>/dev/null || return 0
    backup "$f"
    sed -i "\|mk-face --pam|d" "$f"
    echo "  [-] $f: face taken out"
}

ask() {                # QUESTION: true on y / yes
    local a=""
    read -rp "$1 [y/N]: " a || true
    [[ "$a" =~ ^[yY] ]]
}

if [[ "${1:-}" == "--remove" ]]; then
    for f in /etc/pam.d/sudo /etc/pam.d/gdm-password /etc/pam.d/polkit-1; do remove_line "$f"; done
    echo "Face unlock is off everywhere (your saved face stays in /var/lib/mk-face; mk-face-auth --forget deletes it)."
    exit 0
fi

echo "==> Checking OpenCV"
if ! python3 -c "import cv2, numpy; assert hasattr(cv2, 'FaceDetectorYN') and hasattr(cv2, 'FaceRecognizerSF')" 2>/dev/null; then
    echo "    installing python3-opencv"
    dnf install -y python3-opencv
fi

echo "==> Installing the engine"
install -D -m 755 "$SCRIPT_DIR/assets/libexec/mk-face" "$ENGINE"

echo "==> Models (OpenCV model zoo, checked by SHA-256)"
install -d -m 755 "$MODEL_DIR"
for entry in "${MODELS[@]}"; do
    read -r path sum <<< "$entry"
    file="$MODEL_DIR/$(basename "$path")"
    if [[ -f "$file" ]] && echo "$sum  $file" | sha256sum -c --quiet - 2>/dev/null; then
        echo "  [=] $(basename "$file")"
        continue
    fi
    tmp=$(mktemp)
    curl -fL --retry 2 --max-time 300 -o "$tmp" "$ZOO/$path"
    if ! echo "$sum  $tmp" | sha256sum -c --quiet -; then
        rm -f "$tmp"
        echo "[-] $(basename "$file") didn't match its pinned checksum: not installed." >&2
        exit 1
    fi
    install -m 644 "$tmp" "$file"
    rm -f "$tmp"
    echo "  [+] $(basename "$file")"
done

if [[ -n "$USER_NAME" ]]; then
    echo "==> Your face ($USER_NAME)"
    if [[ -f "/var/lib/mk-face/$USER_NAME.npy" ]] && ! ask "  A face is saved already. Record it again?"; then
        echo "  [=] kept"
    else
        "$ENGINE" enroll "$USER_NAME" || { echo "[-] Enrolling didn't work: run mk-face-auth --enroll later." >&2; }
    fi
    echo "==> A test: look at the camera"
    "$ENGINE" verify "$USER_NAME" 5 || true
fi

echo "==> MK's apps (in-app Face ID)"
if [[ ! -f /etc/pam.d/mk-auth ]] || ! grep -qF "mk-face --pam" /etc/pam.d/mk-auth; then
    backup /etc/pam.d/mk-auth
    install -m 644 "$SCRIPT_DIR/assets/pam/mk-auth" /etc/pam.d/mk-auth
fi
install -D -m 755 "$SCRIPT_DIR/assets/libexec/mk-face-auth" /usr/local/libexec/mk-face-auth
install -m 644 "$SCRIPT_DIR/assets/systemd/mk-face-auth.socket" "$SCRIPT_DIR/assets/systemd/mk-face-auth@.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mk-face-auth.socket &>/dev/null && echo "  [+] in-app Face ID" || echo "  [!] the in-app Face ID socket didn't start"

echo
echo "An ordinary webcam can't tell your face from a photo of it. Face is a convenience: the"
echo "password always works too. Where should it be asked?"
if ask "  sudo in a terminal"; then add_line /etc/pam.d/sudo; fi
if ask "  the lock screen and login (the password field waits up to ~4 s for your face)"; then
    if [[ ! -f /etc/pam.d/gdm-password && -f /usr/lib/pam.d/gdm-password ]]; then
        cp -a /usr/lib/pam.d/gdm-password /etc/pam.d/gdm-password
        echo "    copied /usr/lib/pam.d/gdm-password to /etc/pam.d"
    fi
    add_line /etc/pam.d/gdm-password
fi
echo "Done. mk-face-auth --status shows where it's used; sudo $0 --remove takes it out."

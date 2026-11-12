#!/usr/bin/env bash
# Face unlock on Fedora 45 without Howdy: MK's own OpenCV check (YuNet +
# SFace, python3-opencv), for sudo, the lock screen and MK's apps.
#
#   sudo ./scripts/setup-face-auth.sh             install, enroll, then ask where to use it
#   sudo ./scripts/setup-face-auth.sh --remove    take face out of every PAM file again
#   sudo ./scripts/setup-face-auth.sh --selinux   only the lock screen's SELinux rule (setup.sh runs it)
#   sudo ./scripts/setup-face-auth.sh --diagnose  why the last face checks said no
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
[[ "$USER_NAME" == root ]] && USER_NAME=""          # (faces are enrolled for your account, never root's)
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

# The lock screen checks faces from GDM's worker, confined by SELinux (xdm_t). Rather than open
# the camera and the saved faces to that whole domain (semanage permissive xdm_t would switch
# SELinux off for all of GDM), one rule: xdm_t may connect to the warm face engine's socket
# (/run/mk-face.sock, a system service that does the camera and the faces itself). Enforcing
# stays on. (Fedora 45 no longer has the authlogin_camera boolean older MK versions set.)
selinux_rule() {
    command -v getenforce &> /dev/null && [[ "$(getenforce)" != Disabled ]] || return 0
    if ! command -v checkmodule &> /dev/null || ! command -v semodule_package &> /dev/null; then
        dnf install -y checkpolicy policycoreutils > /dev/null || { echo "  [!] checkpolicy is missing: SELinux rule not installed" >&2; return 1; }
    fi
    local dir
    dir=$(mktemp -d)
    cat > "$dir/mkface.te" << 'TE'
module mkface 1.1;
require {
    type xdm_t;
    type init_t;
    type var_run_t;
    class unix_stream_socket connectto;
    class sock_file write;
}
# the lock screen (GDM's worker, pam_exec mk-face --pam) reaches the warm face engine's socket
allow xdm_t init_t:unix_stream_socket connectto;
allow xdm_t var_run_t:sock_file write;
TE
    if checkmodule -M -m -o "$dir/mkface.mod" "$dir/mkface.te" > /dev/null &&
        semodule_package -o "$dir/mkface.pp" -m "$dir/mkface.mod" && semodule -i "$dir/mkface.pp"; then
        echo "  [+] SELinux: the lock screen may reach the face engine (module mkface; Enforcing stays on)"
    else
        echo "  [!] SELinux rule not installed" >&2
    fi
    rm -rf "$dir"
}

diagnose() {
    echo "== The last face checks (journalctl -t mk-face)"
    journalctl -t mk-face -n 15 --no-pager 2> /dev/null || true
    echo "== PAM's view (pam_exec)"
    journalctl -b --no-pager 2> /dev/null | grep -F "mk-face" | grep -F pam_exec | tail -5 || true
    echo "== SELinux denials today involving the face check or GDM"
    ausearch -m avc -ts today 2> /dev/null | grep -E "mk-face|xdm_t" | tail -10 || echo "   (none)"
    echo "== Where it's used"
    grep -l "mk-face --pam" /etc/pam.d/* 2> /dev/null || echo "   (nowhere)"
    semodule -l 2> /dev/null | grep -qx mkface && echo "== SELinux module mkface: installed" || echo "== SELinux module mkface: missing (sudo $0 --selinux)"
}

ask() {                # QUESTION: true on y / yes
    local a=""
    read -rp "$1 [y/N]: " a || true
    [[ "$a" =~ ^[yY] ]]
}

if [[ "${1:-}" == "--selinux" ]]; then
    selinux_rule
    exit $?
fi
if [[ "${1:-}" == "--diagnose" ]]; then
    diagnose
    exit 0
fi
if [[ "${1:-}" == "--remove" ]]; then
    for f in /etc/pam.d/sudo /etc/pam.d/gdm-password /etc/pam.d/login /etc/pam.d/polkit-1; do remove_line "$f"; done
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
# the warm engine: loaded on demand (the lock screen warms it as the screen locks), gone when idle
install -m 644 "$SCRIPT_DIR/assets/systemd/mk-face.socket" "$SCRIPT_DIR/assets/systemd/mk-face.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mk-face.socket &>/dev/null && echo "  [+] warm face engine (on demand)" || echo "  [!] the warm face engine's socket didn't start"
systemctl try-restart mk-face.service &>/dev/null || true

echo
echo "An ordinary webcam can't tell your face from a photo of it. Face is a convenience: the"
echo "password always works too. Where should it be asked?"
if ask "  sudo in a terminal"; then add_line /etc/pam.d/sudo; fi
if ask "  the lock screen and login (the password field waits up to ~5 s for your face, ~3 s when nobody's at the camera)"; then
    if [[ ! -f /etc/pam.d/gdm-password && -f /usr/lib/pam.d/gdm-password ]]; then
        cp -a /usr/lib/pam.d/gdm-password /etc/pam.d/gdm-password
        echo "    copied /usr/lib/pam.d/gdm-password to /etc/pam.d"
    fi
    add_line /etc/pam.d/gdm-password
    selinux_rule || true
fi
if ask "  console login (a text terminal, Ctrl+Alt+F3)"; then
    if [[ ! -f /etc/pam.d/login && -f /usr/lib/pam.d/login ]]; then
        cp -a /usr/lib/pam.d/login /etc/pam.d/login
        echo "    copied /usr/lib/pam.d/login to /etc/pam.d"
    fi
    add_line /etc/pam.d/login
fi
echo "Done. mk-face-auth --status shows where it's used; sudo $0 --remove takes it out."

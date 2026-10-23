#!/usr/bin/env bash
# Build the MK Notes Android app (dist/MK-Notes.apk) from android/ and the
# phone web app in assets/notes-web. No Android Studio or Gradle needed.
#
#   scripts/build-apk.sh             build dist/MK-Notes.apk
#   scripts/build-apk.sh --install   build, then install on a phone over USB (adb)
#
# Needs a Java compiler (sudo dnf install java-25-openjdk-devel). The first run
# downloads Google's Android SDK command-line tools, build-tools and platform
# (about 250 MB) into ~/.local/share/mk-workstation/android-sdk and asks you to
# accept the Android SDK licence. The app is signed with a key made for you in
# ~/.local/share/mk-workstation/android-key.jks (keep it: updates need it).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/mk-workstation"
SDK="$DATA/android-sdk"
TOOLS_ZIP="commandlinetools-linux-16111833_latest.zip"
BUILD_TOOLS="35.0.0"
PLATFORM="android-35"
KEYSTORE="$DATA/android-key.jks"
KEYPASS_FILE="$DATA/android-key.pass"
OUT="$REPO/dist/MK-Notes.apk"

die() { echo "[-] $*" >&2; exit 1; }

command -v java > /dev/null || die "Java isn't installed: sudo dnf install java-25-openjdk-devel"
command -v javac > /dev/null || die "No Java compiler: sudo dnf install java-25-openjdk-devel"
command -v unzip > /dev/null || die "unzip is missing: sudo dnf install unzip"

# 1. Android SDK pieces (first run only)
if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
    echo "==> Downloading the Android SDK command-line tools (first run only)..."
    mkdir -p "$SDK/cmdline-tools"
    tmp=$(mktemp -d)
    curl -fL --progress-bar -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$TOOLS_ZIP"
    unzip -q "$tmp/tools.zip" -d "$tmp"
    rm -rf "$SDK/cmdline-tools/latest"
    mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
    rm -rf "$tmp"
fi
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
BT="$SDK/build-tools/$BUILD_TOOLS"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
if [[ ! -x "$BT/aapt2" || ! -f "$ANDROID_JAR" ]]; then
    echo "==> Google's Android SDK licence follows; the download needs you to accept it."
    "$SDKMANAGER" --sdk_root="$SDK" --licenses
    "$SDKMANAGER" --sdk_root="$SDK" "build-tools;$BUILD_TOOLS" "platforms;$PLATFORM"
fi

# 2. Build
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "==> Building MK Notes for Android..."
mkdir -p "$work/res" "$work/assets" "$work/classes" "$work/dex" "$(dirname "$OUT")"
cp "$REPO"/assets/notes-web/* "$work/assets/"

# Launcher icons from the app's SVG, at Android's densities.
python3 - "$REPO/assets/icons/io.github.mehulk.MkNotes.svg" "$work/res" << 'PY'
import sys
import gi
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf
svg, res = sys.argv[1:]
import os
for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    folder = os.path.join(res, f"mipmap-{density}")
    os.makedirs(folder, exist_ok=True)
    GdkPixbuf.Pixbuf.new_from_file_at_size(svg, size, size).savev(os.path.join(folder, "ic_launcher.png"), "png", [], [])
PY

"$BT/aapt2" compile --dir "$work/res" -o "$work/res.zip"
"$BT/aapt2" link -o "$work/base.apk" -I "$ANDROID_JAR" --manifest "$REPO/android/AndroidManifest.xml" \
    -A "$work/assets" --java "$work/gen" "$work/res.zip"
mapfile -t sources < <(find "$REPO/android/src" "$work/gen" -name '*.java')
javac -nowarn --release 11 -classpath "$ANDROID_JAR" -d "$work/classes" "${sources[@]}"
mapfile -t classes < <(find "$work/classes" -name '*.class')
"$BT/d8" --release --min-api 26 --lib "$ANDROID_JAR" --output "$work/dex" "${classes[@]}"
cp "$work/base.apk" "$work/unsigned.apk"
(cd "$work/dex" && zip -q "$work/unsigned.apk" classes.dex)
"$BT/zipalign" -f -p 4 "$work/unsigned.apk" "$work/aligned.apk"

# 3. Sign (a key just for you, made once)
if [[ ! -f "$KEYSTORE" ]]; then
    echo "==> Making your app signing key: $KEYSTORE (back it up with $KEYPASS_FILE; updates need both)"
    (umask 077 && head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$KEYPASS_FILE")
    keytool -genkeypair -keystore "$KEYSTORE" -alias mknotes -keyalg RSA -keysize 3072 -validity 10000 \
        -storepass:file "$KEYPASS_FILE" -keypass:file "$KEYPASS_FILE" -dname "CN=MK Notes" > /dev/null
    chmod 600 "$KEYSTORE"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias mknotes --ks-pass "file:$KEYPASS_FILE" \
    --key-pass "file:$KEYPASS_FILE" --out "$OUT" "$work/aligned.apk"
echo "✔ Built $OUT"

if [[ "${1:-}" == "--install" ]]; then
    command -v adb > /dev/null || die "adb isn't installed: sudo dnf install android-tools"
    echo "==> Installing on the phone (USB debugging on, phone unlocked)..."
    adb install -r "$OUT"
    echo "✔ Installed. Open MK Notes on the phone, then scan the Android QR code in MK Notes › Phone."
else
    echo "  Phone over USB: scripts/build-apk.sh --install"
    echo "  Or copy the .apk to the phone and open it (allow installing from Files)."
fi

#!/usr/bin/env bash
set -e

echo "================================================="
echo "   MK Workstation - Howdy Face Scan Setup       "
echo "================================================="

# Auto-detect camera device path
CAM_DEV=$(ls /dev/video* 2>/dev/null | head -n 1 || true)
if [ -z "$CAM_DEV" ]; then
    echo "❌ No camera device found in /dev/video*!"
    exit 1
fi

echo "==> Using detected camera device: $CAM_DEV"
sudo sed -i "s|^device_path = .*|device_path = $CAM_DEV|" /etc/howdy/config.ini 2>/dev/null || \
sudo sed -i "s|^device_path = .*|device_path = $CAM_DEV|" /etc/howdy/config.dhall 2>/dev/null || true

echo "==> Starting Face Scan Registration..."
sudo howdy add

echo "==> Testing Face Recognition (Press Ctrl+C to exit test)..."
sudo howdy test || true

echo "✔ Facial recognition setup complete!"

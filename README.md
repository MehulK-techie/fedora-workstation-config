# ⚡ Fedora MK Workstation

> An automated, zero-touch Infrastructure-as-Code (IaC) deployment suite for Fedora Linux (GNOME / Wayland). Combines developer-ready system optimization, macOS-grade visual minimalism, and Windows PowerToys-grade ergonomics out of the box.

[![Fedora](https://img.shields.io/badge/Fedora_Linux-42_|_43_|_44-51A2DA?logo=fedora&logoColor=white)](https://fedoraproject.org)
[![Desktop](https://img.shields.io/badge/GNOME-Wayland-4A154B?logo=gnome&logoColor=white)](https://www.gnome.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Maintenance](https://img.shields.io/badge/Idempotent-Safe_Rollbacks-success)](#-under-the-hood-for-tech-geeks)

---

## 📋 Dual-Boot Pre-Installation Checklist (Windows ➔ Fedora)

If you are setting up Fedora alongside Windows on a shared SSD, complete these three pre-flight steps in Windows to prevent partition corruption or installer crashes:

| Step | Action | How to Do It |
| :--- | :--- | :--- |
| **1. BitLocker Decryption** | Turn off drive encryption | Open **Control Panel** ➔ **BitLocker Drive Encryption** ➔ Click **Turn off BitLocker**. Wait for decryption to finish. |
| **2. Fast Startup Removal** | Un-mount Windows partition locks | Open **Control Panel** ➔ **Power Options** ➔ **Choose what the power buttons do** ➔ Click *Change settings that are currently unavailable* ➔ **Uncheck "Turn on fast startup"**. |
| **3. Partition Allocation** | Carve out clean disk space | Press `Win + X` ➔ Open **Disk Management** (`diskmgmt.msc`) ➔ Right-click your main volume ➔ Select **Shrink Volume** (leave 60–100 GB as **Unallocated Space**; do not format it). |
| **4. Flashing Live USB** | Create reliable boot media | Download the official **Fedora Workstation Live ISO** (the ~2.5+ GB image). In **Rufus**, select your USB, choose **GPT / UEFI**, and flash in **DD Image Mode** (or use official **Fedora Media Writer**). |

---

## 🚀 Quick Start (One-Liner Setup)

Open your terminal on a fresh Fedora installation and run:

```bash
git clone [https://github.com/MehulK-techie/fedora-workstation-config.git](https://github.com/MehulK-techie/fedora-workstation-config.git)
cd fedora-workstation-config
chmod +x setup.sh sync-shortcuts.sh register-face.sh
sudo ./setup.sh
./sync-shortcuts.sh
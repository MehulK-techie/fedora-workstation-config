# Fedora GNOME Workstation Config & Provisioning Suite

![Fedora](https://img.shields.io/badge/Fedora_Linux-41%2F42-blue?logo=fedora)
![License](https://img.shields.io/badge/License-MIT-green)
![GNOME](https://img.shields.io/badge/Desktop-GNOME_40%2B-blue?logo=gnome)
![ShellCheck](https://img.shields.io/badge/Code_Quality-ShellCheck_Passed-brightgreen)

An automated Infrastructure-as-Code (IaC) suite for Fedora Linux. This repository provides zero-touch system provisioning, low-latency desktop environment keybindings, privacy-safe browser profile synchronization, and local IR facial biometrics.

---

## 🎯 System Architecture & Features

| Component | Functionality | Implementation Details |
| :--- | :--- | :--- |
| **Dual-Boot Onboarding** | Foolproof Windows/Fedora pre-installation safety workflow | BitLocker decryption, Fast Startup removal, BIOS AHCI rules, and Rufus DD-mode flashing guide. |
| **Automated Provisioning** | One-command system deployment (`setup.sh`) | Native DNF package setup, Flathub Flatpaks, GNOME extension deployment, and GSettings configuration. |
| **State Synchronization** | Single-command backup (`sync.sh`) | Dumps live `dconf` trees, active extension lists, and custom shortcuts to Git. |
| **Privacy-Safe Sync** | Non-sensitive browser configuration backup | Backs up Zen Browser CSS (`chrome/`), flags (`user.js`), and keybindings while auto-filtering passwords (`logins.json`) and cookies (`.sqlite`). |
| **Global Window Navigation** | Low-latency `Alt+Tab` window switching | Disables application grouping; forces single-window cycling across **all** open workspaces. |
| **Local Biometrics** | IR Camera facial recognition | Local vector-based facial authentication via Howdy and PAM modules (zero cloud uploads). |

---

## 📋 Dual-Boot Pre-Installation Checklist (Windows $\rightarrow$ Fedora)

To prevent partition corruption or USB boot failures during installation:

1. **BitLocker Decryption:** Disable BitLocker on target drives in Windows (`Control Panel > BitLocker Drive Encryption`).
2. **Fast Startup:** Deactivate Windows Fast Startup (`Power Options > Choose what the power buttons do`) to un-mount drive locks.
3. **Partition Allocation:** Create unallocated free space using `diskmgmt.msc`.
4. **Bootable USB Creation:** 
   * Download the full **2.7 GB Live ISO** from Fedora (do not select the 365-byte checksum file).
   * Ensure the ISO is stored on your host drive (`C:`), not inside the target flash drive.
   * In **Rufus**, select **GPT** partition scheme and flash using **DD Image Mode** (or use **Fedora Media Writer**).

---

## 🚀 Quick Start Guide

### Fresh System Setup
On a clean Fedora installation, clone this repository and run the provisioning engine:

```bash
git clone [https://github.com/MehulK-techie/fedora-workstation-config.git](https://github.com/MehulK-techie/fedora-workstation-config.git) ~/Desktop/Fedora_workspace_MK
cd ~/Desktop/Fedora_workspace_MK
chmod +x setup.sh sync.sh
./setup.sh
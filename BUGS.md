# Comprehensive Audit Report: Fedora MK Workstation (BUGS.md)

**Target OS:** Fedora Linux 44 (Workstation Edition) | GNOME 50 Shell on Wayland  
**Repository:** MehulK-techie/fedora-workstation-config  
**Hardware Profile:** HP Laptop (HP Wide Vision HD Camera: /dev/video0, /dev/video1)  

---

## 1. Identified Bugs, Security Vulnerabilities & Regressions

### Bug 1.1: Root-Default Facial Registration (Critical Auth Flaw)
* **Location:** `register-face.sh`
* **Vulnerability:** When running `sudo ./register-face.sh`, executing bare `sudo howdy add` registers face models under user `root` instead of the active desktop user.
* **Impact:** The desktop user (`mehulkumar`) cannot authenticate at the GDM login screen or with `sudo` using facial recognition unless `-U "$REAL_USER"` is explicitly passed.
* **Resolution:** Target user is resolved via `${SUDO_USER:-$(logname)}` and invoked as `howdy -U "$REAL_USER" add`.

### Bug 1.2: Stale PAM 2.x Module Collision in `/etc/pam.d/sudo`
* **Location:** `/etc/pam.d/sudo`
* **Vulnerability:** The active PAM config contained:
  `auth sufficient pam_python.so /lib64/security/howdy/pam.py`
  Howdy 3.x (from Copr `principis/howdy`) uses the native C module `pam_howdy.so`.
* **Impact:** Redundant PAM evaluation failures, warnings, or silent fallback when `pam_python.so` is absent.
* **Resolution:** Cleaned using regex `/pam_python\.so.*howdy/d` to sanitize the file before prepending `auth sufficient pam_howdy.so`.

### Bug 1.3: DNF Configuration Duplication & Idempotency Failure
* **Location:** `setup.sh` -> `/etc/dnf/dnf.conf`
* **Vulnerability:** Repeated runs produced duplicated keys:
  - `max_parallel_downloads=10`
  - `fastestmirror=True`
* **Impact:** Inconsistent DNF parsing and configuration pollution.
* **Resolution:** Scrub lines matching `(max_parallel_downloads|fastestmirror|defaultyes)` before injecting single authoritative keys under `[main]`.

### Bug 1.4: Blind Camera Node Selection on HP Dual-Sensor Hardware
* **Location:** `register-face.sh` (`CAM_DEV=$(ls /dev/video* 2>/dev/null | head -n 1)`)
* **Vulnerability:** The HP Wide Vision HD camera exposes both `/dev/video0` and `/dev/video1`. Picking `head -n 1` blindly defaults to `/dev/video0`, which fails on systems requiring the IR sensor for facial verification.
* **Resolution:** Added device detection via `v4l2-ctl` and interactive device prompt with default fallback.

### Bug 1.5: GNOME Shell Version Mismatch / Extension Disabling
* **Location:** `extensions/mk-indicator@mehulk/metadata.json`
* **Vulnerability:** Metadata targeted `"shell-version": ["44", "45", "46", "47"]`, whereas Fedora 44 runs GNOME Shell 50 (`Version: 50.4`).
* **Impact:** GNOME Shell flags the extension as incompatible and sets state to `INITIALIZED` without enabling it.
* **Resolution:** Appended `"48", "49", "50"` to the `shell-version` array in `metadata.json`.

---

## 2. Hallucinations & Flawed Architectural Assumptions

1. **Immediate `gnome-extensions enable` without Shell Discovery:**
   * *Assumption:* Copying files to `~/.local/share/gnome-shell/extensions` and immediately running `gnome-extensions enable mk-indicator@mehulk` in the same script.
   * *Reality:* Under GNOME Wayland, the Shell process does not watch filesystem directories for brand new extensions dynamically. It requires a session re-login or an explicit DBus reload trigger before it can be activated.
2. **Hardcoded Package Lists vs. Repository Manifests:**
   * *Assumption:* Maintaining package lists directly inside `setup.sh` while having `apps/dnf-packages.txt` and `apps/flatpaks.txt` in the repository.
   * *Reality:* Leads to drift between repository manifests and setup execution. `setup.sh` should parse the `.txt` manifests directly.

---

## 3. Comparative Analysis with Similar Workstation Repositories

| Feature / Architecture | Universal Blue / Bluefin | Chris Titus Linutil | Fedora Silverblue IaC | Fedora MK Workstation (Current) |
| :--- | :--- | :--- | :--- | :--- |
| **Package Engine** | Bootc / Containerfile + Homebrew | Modular Bash CLI | RPM-OSTree Layering | Native DNF5 / DNF + Flatpak |
| **Btrfs Snapshot Safeguards**| Built-in rollback images | Snapper + Btrfs Hooks | Native OSTree rollbacks | Missing (Needs Snapper integration) |
| **Execution Tooling** | `justfile` (`just setup`) | Dialog / Whiptail TUI | Ansible Playbooks | Shell scripts (`setup.sh`, `sync.sh`) |
| **Dotfile / Config Engine** | Declarative Git Bare Repo | Chezmoi / Symlink Tree | Git Submodules | Ad-hoc `dconf` files |
| **Hardware & Power Tuning** | `power-profiles-daemon` | `auto-cpufreq` / TLP | Stock Power Profiles | Stock GNOME Power Profiles |

---

## 4. High-Value Features Recommended for Adoption

1. **Snapper + Btrfs Automatic Snapshots:**
   Fedora uses Btrfs root by default. Before modifying `/etc/pam.d/` or running DNF transactions, create an automated snapshot (`snapper create -d "Pre-MK-Setup"`).
2. **Unified Package Manifests:**
   Replace the hardcoded `dnf install` package list inside `setup.sh` with a loop reading directly from `apps/dnf-packages.txt` and `apps/flatpaks.txt`.
3. **Power & Thermal Profile Automation for HP Laptops:**
   Add `tuned` or `power-profiles-daemon` CLI rules to automatically switch to `performance` on AC power and `balanced`/`power-saver` on battery.
4. **Transition to `justfile`:**
   Provide a single `just` runner file in the repository root for simple developer interactions:
   * `just install` -> runs `setup.sh`
   * `just face` -> runs `register-face.sh`
   * `just sync` -> dumps DConf settings to `config/`

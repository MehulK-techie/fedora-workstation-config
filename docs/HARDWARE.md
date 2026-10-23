# Hardware

MK Workstation doesn't assume a machine. It looks at what's there and sets up
only what fits, so the same command tunes a 2-in-1 laptop, a ThinkPad or a
desktop tower. Run `mk device` to see what it found on yours. On the
author's laptop, after `sudo ./setup.sh` and one enrolled finger:

```text
HP ENVY x360 Convertible 13-ay0xxx  (convertible)

  ✔ CPU           AMD Ryzen 5 4500U with Radeon Graphics · 6 threads · acpi-cpufreq
  ✔ Memory        7.1 GiB · effects auto (auto picks full)
  ✔ Video         AMD Renoir · GPU decodes H.264, HEVC, VP9
  ✔ Battery       64% · smart power profiles (mk power)
  ! Touch         touchscreen + stylus · no rotation sensor exposed by the firmware
  ✔ Fingerprint   Synaptics 06cb:00e7 · 1 finger(s) enrolled
  ✔ Camera        HP Wide Vision HD Camera · RGB: face unlock in good light (mk face)
```

## What gets detected, and what happens

| Hardware | How it's found | What MK does | Where |
| :--- | :--- | :--- | :--- |
| Fingerprint reader | fprintd lists a device | Turns on fingerprint for login and `sudo` (`authselect enable-feature -b with-fingerprint`, which backs up PAM first); `mk fingerprint` enrolls | `setup.sh` |
| Webcam (RGB or IR) | Video devices; IR in the name | Howdy face unlock; IR gets stricter defaults and `sudo` support, RGB asks first | `setup.sh`, `register-face.sh` |
| GPU (Intel, AMD, NVIDIA) | `lspci` | The matching VA-API driver, so H.264/HEVC video decodes on the GPU | `setup.sh` |
| Battery | `/sys/class/power_supply/BAT*` | Smart power profiles: performance on AC, balanced on battery, power-saver when low | `sync.sh`, `bin/mk-power` |
| 2-in-1 / tablet | `hostnamectl chassis` | Installs `iio-sensor-proxy` for auto-rotation and tablet mode | `setup.sh` |
| Weak hardware | RAM, cores, GPU rendering | `mk effects auto` switches off blur and window effects | `sync.sh`, `config/effects.conf` |
| Touchpad | input devices | Tap to click, natural scrolling, 3- and 4-finger gestures | `sync.sh` |
| Your monitors | `~/.config/monitors.xml` | The login screen uses the same resolution and scaling, so logging in doesn't flicker | `setup.sh` |

Everything above is skipped quietly on machines that don't have it.

## Fingerprint login

1. `sudo ./setup.sh` once (turns fingerprint login on when a reader exists).
2. `mk fingerprint` and touch the sensor about 8–12 times, shifting your
   finger a little each time.
3. Lock the screen (Super+L) and touch the sensor.

```bash
mk fingerprint enroll left-index-finger   # add more fingers
mk fingerprint list                       # see what's enrolled
mk fingerprint delete                     # remove all of yours
mk fingerprint settings                   # the same in GNOME Settings › Users
```

Fingerprint and face unlock work side by side: on the login screen GNOME
offers both. `sudo` tries face first if you enabled face unlock for it,
then fingerprint, then your password. Fingerprint data stays on the computer (in fprintd's store or on
the reader itself) and is never part of this repository.

## Smooth login and unlock

- **Login:** the login screen gets your display layout, so there's no mode
  change (and black flash) between the login screen and the desktop.
- **Unlock:** GNOME switches most extensions off while the screen is locked
  and back on when you unlock. MK's own extension stays loaded across the lock
  so unlocking doesn't rebuild it, and it no longer re-applies the top-bar
  blur after each unlock (that was a visible hitch).
- **Lighter effects:** if unlocking or animations still stutter on an older
  machine, `mk effects lite`.

## Tested machines

| Machine | Notes |
| :--- | :--- |
| **HP ENVY x360 Convertible 13-ay0xxx** (Ryzen 5 4500U, Radeon Vega 6, 8 GB, Synaptics 06cb:00e7 reader, ELAN touchscreen + stylus, RGB webcam) | The author's daily machine. Everything works, with three model quirks: the firmware has no CPPC, so the CPU uses `acpi-cpufreq` (not `amd-pstate`) and smart power profiles do the tuning; the accelerometer isn't exposed to Linux, so the screen doesn't auto-rotate; the webcam is RGB, so face unlock wants good light. |

Tried it on another machine? Open an issue or pull request with the output of
`mk device` and anything that didn't work, and it'll be added here.

## Adding support for something

Detection lives in `lib/mkworkstation/device.py` (the `mk device` report) and
the hardware section of `setup.sh` (step 7b). Keep each addition
self-contained: detect first, act only if found, back up any system file
before changing it, and make re-running harmless. See
[ARCHITECTURE.md](ARCHITECTURE.md).

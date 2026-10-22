# Full System & Repository Context Dump
Generated on: Thu Oct 22 10:18:49 PM IST 2026

## OS & Kernel Info
```
NAME="Fedora Linux"
VERSION="44 (Workstation Edition)"
ID=fedora
VERSION_ID=44
VERSION_CODENAME=""
PRETTY_NAME="Fedora Linux 44 (Workstation Edition)"
CPE_NAME="cpe:/o:fedoraproject:fedora:44"
DEFAULT_HOSTNAME="fedora"
REDHAT_BUGZILLA_PRODUCT_VERSION=44
REDHAT_SUPPORT_PRODUCT_VERSION=44
VARIANT_ID=workstation
7.2.11-200.fc44.x86_64
Desktop: GNOME
Session: wayland
```

## Video Devices (/dev/video*)
```
HP Wide Vision HD Camera: HP Wi (usb-0000:04:00.3-4):
	/dev/video0
	/dev/video1
	/dev/media0
```

## SELinux Status
```
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
Policy MLS status:              enabled
Policy deny_unknown status:     allowed
Memory protection checking:     actual (secure)
Max kernel policy version:      35
```

## /etc/dnf/dnf.conf
```
# see `man dnf.conf` for defaults and possible options

[main]
max_parallel_downloads=10
fastestmirror=True
max_parallel_downloads=10
fastestmirror=True
defaultyes=True
```

## Enabled Repositories
```
repo id                                                       repo name
code                                                          Visual Studio Code
copr:copr.fedorainfracloud.org:alvarogarinf:howdy             Copr repo for howdy owned by alvarogarinf
copr:copr.fedorainfracloud.org:manciukic:libfprint-tod-goodix Copr repo for libfprint-tod-goodix owned by manciukic
copr:copr.fedorainfracloud.org:phracek:PyCharm                Copr repo for PyCharm owned by phracek
copr:copr.fedorainfracloud.org:principis:howdy                Copr repo for howdy owned by principis
copr:copr.fedorainfracloud.org:principis:howdy-beta           Copr repo for howdy-beta owned by principis
copr:copr.fedorainfracloud.org:quantt:libfprint-tod           Copr repo for libfprint-tod owned by quantt
fedora                                                        Fedora 44 - x86_64
fedora-cisco-openh264                                         Fedora 44 openh264 (From Cisco) - x86_64
google-chrome                                                 google-chrome
rpmfusion-free                                                RPM Fusion for Fedora 44 - Free
rpmfusion-free-updates                                        RPM Fusion for Fedora 44 - Free - Updates
rpmfusion-nonfree                                             RPM Fusion for Fedora 44 - Nonfree
rpmfusion-nonfree-nvidia-driver                               RPM Fusion for Fedora 44 - Nonfree - NVIDIA Driver
rpmfusion-nonfree-steam                                       RPM Fusion for Fedora 44 - Nonfree - Steam
rpmfusion-nonfree-updates                                     RPM Fusion for Fedora 44 - Nonfree - Updates
updates                                                       Fedora 44 - x86_64 - Updates
```

## /etc/pam.d/sudo
```
auth sufficient pam_python.so /lib64/security/howdy/pam.py
#%PAM-1.0
auth       include      system-auth
account    include      system-auth
password   include      system-auth
session    optional     pam_keyinit.so revoke
session    required     pam_limits.so
session    include      system-auth
```

## /etc/pam.d/gdm-password
```
auth        sufficient    pam_howdy.so
auth     [success=done ignore=ignore default=bad] pam_selinux_permit.so
auth        substack      password-auth
auth        optional      pam_gnome_keyring.so
auth        include       postlogin

account     required      pam_nologin.so
account     include       password-auth

password    substack       password-auth
-password   optional       pam_gnome_keyring.so use_authtok

session     required      pam_selinux.so close
session     required      pam_loginuid.so
session     required      pam_selinux.so open
session     optional      pam_keyinit.so force revoke
session     required      pam_namespace.so
session     include       password-auth
session     optional      pam_gnome_keyring.so auto_start
session     include       postlogin
```

## Howdy Config (config.ini)
```
[core]
text_validation = Face detected
show_contacts = false
# Print that face detection is being attempted
detection_notice = false

# Print that face detection has timed out
timeout_notice = true

# Do not print anything when a face verification succeeds
no_confirmation = false

# When a user without a known face model tries to use this script, don't
# show an error but fail silently
suppress_unknown = false

# Disable Howdy in remote shells
abort_if_ssh = true

# Disable Howdy if lid is closed
abort_if_lid_closed = true

# Disable howdy in the PAM
# The howdy command will still function
disabled = false

# Use CNN instead of HOG
# CNN model is much more accurate than the HOG based model, but takes much more
# power to run, and is meant to be executed on a GPU to attain reasonable speed.
use_cnn = false

# Set a workaround to do face and password authentication at the same time
#  off     user will have to press enter themselves after a Howdy timeout
#  input   will send an enter keypress to stop the password prompt
#  native  will stop the prompt at PAM level (can lead to instability!)
workaround = off

[video]
# The certainty of the detected face belonging to the user of the account
# On a scale from 1 to 10, values above 5 are not recommended
# The lower, the more accurate
certainty = 4.0

# The number of seconds to search before timing out
timeout = 2

# The path of the device to capture frames from
# Video devices are usually found in /dev/v4l/by-path/
device_path = /dev/video0

# Print a warning if the the video device is not found
warn_no_device = true

# Scale down the video feed to this maximum height
# Speeds up face recognition but can make it less precise
max_height = 480

# Set the camera input profile to this width and height
# The largest profile will be used if set to -1
# Automatically ignored if not a valid profile
frame_width = -1
frame_height = -1

# Because of flashing IR emitters, some frames can be completely unlit
# Skip the frame if the lowest 1/8 of the histogram is above this percentage
# of the total
# The lower this setting is, the more dark frames are ignored
dark_threshold = 50

# The recorder to use. Can be either opencv (default), ffmpeg or pyv4l2.
# Switching from the default opencv to ffmpeg can help with grayscale issues.
recording_plugin = opencv

# Video format used by ffmpeg. Options include vfwcap or v4l2.
# FFMPEG only.
device_format = v4l2

# Force the use of Motion JPEG when decoding frames, fixes issues with YUYV
# raw frame decoding.
# OPENCV only.
force_mjpeg = false

# Specify exposure value explicitly. This disables autoexposure.
# Use qv4l2 to determine an appropriate value.
# OPENCV only.
exposure = -1

# Specify frame rate of the capture device.
# Some IR emitters will not function properly at the default framerate.
# Use qv4l2 to determine an appropriate value.
# OPENCV only.
device_fps = -1

# Rotate captured frames so faces are upright.
#  0  Check landscape orientation only
#  1  Check both landscape and portrait orientation
#  2  Check portrait orientation only
rotate = 0

[snapshots]
# Capture snapshots of failed login attempts and save them to disk with metadata
# Snapshots are saved to /var/log/howdy/snapshots
save_failed = false

# Do the same as the option above but for successful attempts
save_successful = false

[rubberstamps]
# Enable specific extra checks after the user has been recognised
enabled = false

# What type of stamps to run and with what options. The type, timeout and
# failure mode are required. One line per stamp. Rule syntax:
#  stamptype  timeout  (failsafe | faildeadly)   [extra_argument=value]
stamp_rules =
    nod        5s        failsafe   min_distance=12

[debug]
# Show a short but detailed diagnostic report in console
# Enabling this can cause some UI apps to fail, only enable it to debug
end_report = false

# More verbose logging from the rubberstamps system
verbose_stamps = false

# Pass output of the GTK auth window to the terminal
gtk_stdout = false
```

## Howdy User List
```
Known face models for mehulkumar:

[1;29mID  Date                 Label[0m
0   2026-10-07 17:26:16  MK
1   2026-10-11 14:53:15  MK
2   2026-10-15 21:45:05  MK_2

```

## Installed GNOME Extensions
```
touchpad-gesture-customization@coooolapps.com
  Name: Touchpad Gesture Customization
  Description: An extension which enable touchpad gestures customization in GNOME using Wayland. For full list of supported features please visit https://github.com/HieuTNg/touchpad-gesture-customization
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/touchpad-gesture-customization@coooolapps.com
  URL: https://github.com/HieuTNg/touchpad-gesture-customization
  Version: 28
  Enabled: Yes
  State: ACTIVE

blur-my-shell@aunetx
  Name: Blur my Shell
  Description: Adds a blur look to different parts of GNOME Shell, including the top panel, dash and overview.

You can support my work by sponsoring me on:
- GitHub: https://github.com/sponsors/aunetx
- Ko-fi: https://ko-fi.com/aunetx

Note: if the extension shows an error after updating, restart your session to see whether it persists. This is due to a GNOME Shell bug that the extension cannot work around.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/blur-my-shell@aunetx
  URL: https://github.com/aunetx/blur-my-shell
  Version: 76
  Enabled: Yes
  State: ACTIVE

tiling-assistant@leleat-on-github
  Name: Tiling Assistant
  Description: Expand GNOME's 2 column tiling and add a Windows-snap-assist-inspired popup...
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/tiling-assistant@leleat-on-github
  URL: https://github.com/ubuntu/Tiling-Assistant
  Version: 56
  Enabled: Yes
  State: ACTIVE

quick-settings-tweaks@qwreey
  Name: Quick Settings Tweaks
  Description: Let's tweak gnome's quick settings! You can add Media Controls, Notifications, Volume Mixer on quick settings and remove useless buttons!
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/quick-settings-tweaks@qwreey
  URL: https://github.com/qwreey/quick-settings-tweaks
  Version: 30
  Enabled: No
  State: INITIALIZED

macos-dock@vinnytherobot.github.io
  Name: MacOS Dock
  Description: A macOS-style dock for GNOME Shell with magnification and animations
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/macos-dock@vinnytherobot.github.io
  URL: https://github.com/vinnytherobot/MacOSDock
  Version: 15
  Enabled: No
  State: INITIALIZED

just-perfection-desktop@just-perfection
  Name: Just Perfection
  Description: Tweak Tool to Customize GNOME Shell, Change the Behavior and Disable UI Elements
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/just-perfection-desktop@just-perfection
  URL: https://gitlab.gnome.org/jrahmatzadeh/just-perfection
  Version: 37
  Enabled: No
  State: INITIALIZED

ding@rastersoft.com
  Name: Desktop Icons NG (DING)
  Description: Adds icons to the desktop. Fork of the original Desktop Icons extension, with several enhancements .
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/ding@rastersoft.com
  URL: https://gitlab.com/rastersoft/desktop-icons-ng
  Version: 100
  Enabled: No
  State: INITIALIZED

burn-my-windows@schneegans.github.com
  Name: Burn My Windows
  Description: Disintegrate your windows with style.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/burn-my-windows@schneegans.github.com
  URL: https://github.com/Schneegans/Burn-My-Windows
  Version: 49
  Enabled: No
  State: INITIALIZED

monitor@astraext.github.io
  Name: Astra Monitor
  Description: Astra Monitor is a cutting-edge, fully customizable, and performance-focused system monitoring extension for GNOME's top bar. It's an all-in-one solution for those seeking to keep a close eye on their system's performance metrics like CPU, GPU, RAM, disk usage, network statistics, and sensor readings.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/monitor@astraext.github.io
  URL: https://github.com/AstraExt/astra-monitor
  Version: 43 (62)
  Enabled: Yes
  State: ACTIVE

clipboard-indicator@tudmotu.com
  Name: Clipboard Indicator
  Description: The most popular clipboard manager for GNOME, with over 1M downloads
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com
  URL: https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator
  Version: 71
  Enabled: Yes
  State: ACTIVE

compiz-windows-effect@hermes83.github.com
  Name: Compiz windows effect
  Description: Compiz wobbly windows effect

-----------------------------------
Video
-----------------------------------
https://youtu.be/G8bAVIB9A7A
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/compiz-windows-effect@hermes83.github.com
  URL: https://github.com/hermes83/compiz-windows-effect
  Version: 33
  Enabled: Yes
  State: ACTIVE

caffeine@patapon.info
  Name: Caffeine
  Description: Disable the screensaver and auto suspend
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/caffeine@patapon.info
  URL: https://github.com/eonpatapon/gnome-shell-extension-caffeine
  Version: 61
  Enabled: No
  State: INITIALIZED

transparent-top-bar@ftpix.com
  Name: Transparent Top Bar (Adjustable transparency)
  Description: Fork of: https://github.com/zhanghai/gnome-shell-extension-transparent-top-bar

Bring back the transparent top bar in GNOME Shell with adjustable transparency.

Does not work well with custom shell themes.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/transparent-top-bar@ftpix.com
  URL: https://github.com/lamarios/gnome-shell-extension-transparent-top-bar
  Version: 28
  Enabled: Yes
  State: ACTIVE

wack-lockscreen-clock@rinzler69-wastaken.github.com
  Name: WACK - Sonoma Lockscreen
  Description: macOS Sonoma-inspired lock screen for GNOME Shell. Part of the WACK Project.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/wack-lockscreen-clock@rinzler69-wastaken.github.com
  URL: https://github.com/rinzler69-wastaken/wack-sonoma-lockscreen
  Version: 2.1.0 (46)
  Enabled: Yes
  State: INACTIVE

screenshot-ocr@nbubis.github.com
  Name: Screenshot OCR
  Description: Run OCR on screenshots and copy text to clipboard
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/screenshot-ocr@nbubis.github.com
  URL: https://github.com/nbubis/gnome-screenshot-ocr
  Version: 1
  Enabled: No
  State: INITIALIZED

wack-shell@rinzler69-wastaken.github.com
  Name: WACK Shell
  Description: A macOS-inspired panel suite for GNOME featuring live panel vibrancy, proximity-aware panel coloring, and — when paired with WACK Sonoma Lockscreen — a seamless Cupertino unlock animation powered by real window texture snapshots. Part of the WACK Project.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/wack-shell@rinzler69-wastaken.github.com
  URL: https://github.com/rinzler69-wastaken/wack-shell
  Version: 1.0.0
  Enabled: Yes
  State: ACTIVE

compiz-alike-magic-lamp-effect@hermes83.github.com
  Name: Compiz alike magic lamp effect
  Description: Magic lamp effect inspired by the Compiz ones

NB:
In case of update error please restart Gnome Shell (on Xorg press ALT+F2 then write r and press enter, on Wayland end the session and log in again)
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/compiz-alike-magic-lamp-effect@hermes83.github.com
  URL: https://github.com/hermes83/compiz-alike-magic-lamp-effect
  Version: 25
  Enabled: No
  State: INITIALIZED

text-extractor@imshaaz21.github.com
  Name: OCR Text Extractor
  Description: PowerToys Text Extractor equivalent for GNOME. Select an area of the screen and copy its text with OCR (Tesseract), in any language Tesseract supports. Requires Tesseract OCR to be installed. Clipboard access: it only writes the extracted text.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/text-extractor@imshaaz21.github.com
  URL: https://github.com/imshaaz21/text-extractor-gnome
  Version: 1.4.0 (7)
  Enabled: Yes
  State: ACTIVE

CoverflowAltTab@palatis.blogspot.com
  Name: Coverflow Alt-Tab
  Description: Replacement of Alt-Tab, iterates through windows in a cover-flow manner.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/CoverflowAltTab@palatis.blogspot.com
  URL: https://github.com/dsheeler/CoverflowAltTab
  Version: 88
  Enabled: No
  State: INITIALIZED

emoji-copy@felipeftn
  Name: Emoji Copy
  Description: Emoji copy is a versatile extension designed to simplify emoji selection and clipboard management.

It is a fork of Emoji Selector.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/emoji-copy@felipeftn
  URL: https://github.com/felipeftn/emoji-copy
  Version: 40
  Enabled: Yes
  State: ACTIVE

mk-indicator@mehulk
  Name: MK Workstation Indicator
  Description: Displays the custom MK Workstation Edition watermark badge on the top status panel.
  Path: /home/mehulkumar/.local/share/gnome-shell/extensions/mk-indicator@mehulk
  Enabled: No
  State: INITIALIZED

apps-menu@gnome-shell-extensions.gcampax.github.com
  Name: Apps Menu
  Description: Add a category-based menu for apps.
This extension is part of Classic Mode and is officially supported by GNOME. Please do not report bugs using the form below, use GNOME's GitLab instance instead.
  Path: /usr/share/gnome-shell/extensions/apps-menu@gnome-shell-extensions.gcampax.github.com
  URL: https://gitlab.gnome.org/GNOME/gnome-shell-extensions
  Version: 50.4
  Enabled: No
  State: INITIALIZED

background-logo@fedorahosted.org
  Name: Background Logo
  Description: Overlay a tasteful logo on the background to enhance the user experience
  Path: /usr/share/gnome-shell/extensions/background-logo@fedorahosted.org
  URL: https://forge.fedoraproject.org/workstation/background-logo-extension
  Version: 50.1
  Enabled: No
  State: INITIALIZED

launch-new-instance@gnome-shell-extensions.gcampax.github.com
  Name: Launch New Instance
  Description: Always launch a new instance when clicking in the dash or the application view.
This extension is part of Classic Mode and is officially supported by GNOME. Please do not report bugs using the form below, use GNOME's GitLab instance instead.
  Path: /usr/share/gnome-shell/extensions/launch-new-instance@gnome-shell-extensions.gcampax.github.com
  URL: https://gitlab.gnome.org/GNOME/gnome-shell-extensions
  Version: 50.4
  Enabled: No
  State: INITIALIZED

places-menu@gnome-shell-extensions.gcampax.github.com
  Name: Places Status Indicator
  Description: Add a menu for quickly navigating places in the system.
This extension is part of Classic Mode and is officially supported by GNOME. Please do not report bugs using the form below, use GNOME's GitLab instance instead.
  Path: /usr/share/gnome-shell/extensions/places-menu@gnome-shell-extensions.gcampax.github.com
  URL: https://gitlab.gnome.org/GNOME/gnome-shell-extensions
  Version: 50.4
  Enabled: Yes
  State: ACTIVE

window-list@gnome-shell-extensions.gcampax.github.com
  Name: Window List
  Description: Display a window list at the bottom of the screen.
This extension is part of Classic Mode and is officially supported by GNOME. Please do not report bugs using the form below, use GNOME's GitLab instance instead.
  Path: /usr/share/gnome-shell/extensions/window-list@gnome-shell-extensions.gcampax.github.com
  URL: https://gitlab.gnome.org/GNOME/gnome-shell-extensions
  Version: 50.4
  Enabled: No
  State: INITIALIZED

dash-to-dock@micxgx.gmail.com
  Name: Dash to Dock
  Description: A dock for the Gnome Shell. This extension moves the dash out of the overview transforming it in a dock for an easier launching of applications and a faster switching between windows and desktops. Side and bottom placement options are available.
  Path: /usr/share/gnome-shell/extensions/dash-to-dock@micxgx.gmail.com
  URL: https://micheleg.github.io/dash-to-dock/
  Original author: micxgx@gmail.com
  Version: 105
  Enabled: Yes
  State: ACTIVE

dash-to-panel@jderose9.github.com
  Name: Dash to Panel
  Description: An icon taskbar for the Gnome Shell. This extension moves the dash into the gnome main panel so that the application launchers and system tray are combined into a single panel, similar to that found in KDE Plasma and Windows 7+. A separate dock is no longer needed for easy access to running and favorited applications.

For a more traditional experience, you may also want to use Tweak Tool to enable Windows > Titlebar Buttons > Minimize & Maximize.

For the best support, please report any issues on Github. Dash-to-panel is developed and maintained by @jderose9 and @charlesg99.
  Path: /usr/share/gnome-shell/extensions/dash-to-panel@jderose9.github.com
  URL: https://github.com/home-sweet-gnome/dash-to-panel
  Version: 73
  Enabled: No
  State: INITIALIZED

appindicatorsupport@rgcjonas.gmail.com
  Name: AppIndicator and KStatusNotifierItem Support
  Description: Adds AppIndicator, KStatusNotifierItem and legacy Tray icons support to the Shell
  Path: /usr/share/gnome-shell/extensions/appindicatorsupport@rgcjonas.gmail.com
  URL: https://github.com/ubuntu/gnome-shell-extension-appindicator
  Enabled: No
  State: INITIALIZED
```

## User GNOME Extensions Directory
```
total 0
drwxr-xr-x. 1 mehulkumar mehulkumar 1372 Oct 22 14:58 .
drwx------. 1 mehulkumar mehulkumar  196 Oct 22 22:17 ..
drwxr-xr-x. 1 mehulkumar mehulkumar  282 Oct 20 18:04 blur-my-shell@aunetx
drwxr-xr-x. 1 mehulkumar mehulkumar  130 Oct  8 20:39 burn-my-windows@schneegans.github.com
drwxr-xr-x. 1 mehulkumar mehulkumar  164 Oct  9 16:42 caffeine@patapon.info
drwxr-xr-x. 1 mehulkumar mehulkumar  242 Oct  8 21:03 clipboard-indicator@tudmotu.com
drwxr-xr-x. 1 mehulkumar mehulkumar  126 Oct 20 18:21 compiz-alike-magic-lamp-effect@hermes83.github.com
drwxr-xr-x. 1 mehulkumar mehulkumar  132 Oct 11 15:35 compiz-windows-effect@hermes83.github.com
drwxr-xr-x. 1 mehulkumar mehulkumar  442 Oct 22 01:11 CoverflowAltTab@palatis.blogspot.com
drwxr-xr-x. 1 mehulkumar mehulkumar  172 Oct 18 23:18 ding@rastersoft.com
drwxr-xr-x. 1 mehulkumar mehulkumar  308 Oct 22 01:23 emoji-copy@felipeftn
drwxr-xr-x. 1 mehulkumar mehulkumar  202 Oct  7 18:09 just-perfection-desktop@just-perfection
drwxr-xr-x. 1 mehulkumar mehulkumar  114 Oct 19 09:39 macos-dock@vinnytherobot.github.io
drwxr-xr-x. 1 mehulkumar mehulkumar   50 Oct 22 14:58 mk-indicator@mehulk
drwxr-xr-x. 1 mehulkumar mehulkumar  190 Oct 12 14:53 monitor@astraext.github.io
drwxr-xr-x. 1 mehulkumar mehulkumar  208 Oct  7 00:20 quick-settings-tweaks@qwreey
drwxr-xr-x. 1 mehulkumar mehulkumar   50 Oct 15 00:44 screenshot-ocr@nbubis.github.com
drwxr-xr-x. 1 mehulkumar mehulkumar  102 Oct 22 01:06 text-extractor@imshaaz21.github.com
drwxr-xr-x. 1 mehulkumar mehulkumar  136 Oct 11 15:35 tiling-assistant@leleat-on-github
drwxr-xr-x. 1 mehulkumar mehulkumar  176 Oct 18 23:18 touchpad-gesture-customization@coooolapps.com
drwxr-xr-x. 1 mehulkumar mehulkumar  108 Oct 11 14:48 transparent-top-bar@ftpix.com
drwxr-xr-x. 1 mehulkumar mehulkumar  140 Oct 12 23:29 wack-lockscreen-clock@rinzler69-wastaken.github.com
drwxr-xr-x. 1 mehulkumar mehulkumar  538 Oct 15 23:50 wack-shell@rinzler69-wastaken.github.com
```

## System GNOME Extensions Directory
```
total 0
drwxr-xr-x. 1 root root 740 Oct 20 18:21 .
drwxr-xr-x. 1 root root 890 Oct 18 23:25 ..
drwxr-xr-x. 1 root root 544 Oct 20 18:21 appindicatorsupport@rgcjonas.gmail.com
drwxr-xr-x. 1 root root  78 Oct 14 21:31 apps-menu@gnome-shell-extensions.gcampax.github.com
drwxr-xr-x. 1 root root  80 Oct 14 21:32 background-logo@fedorahosted.org
drwxr-xr-x. 1 root root 196 Oct 18 23:54 blur-my-shell@aunetx
drwxr-xr-x. 1 root root 680 Oct  8 11:10 dash-to-dock@micxgx.gmail.com
drwxr-xr-x. 1 root root 534 Oct 11 15:24 dash-to-panel@jderose9.github.com
drwxr-xr-x. 1 root root  50 Oct 14 21:31 launch-new-instance@gnome-shell-extensions.gcampax.github.com
drwxr-xr-x. 1 root root 108 Oct 14 21:31 places-menu@gnome-shell-extensions.gcampax.github.com
drwxr-xr-x. 1 root root 374 Oct 14 21:31 window-list@gnome-shell-extensions.gcampax.github.com
```

## Custom Indicator Extension metadata.json
```
{
  "uuid": "mk-indicator@mehulk",
  "name": "MK Workstation Indicator",
  "description": "Displays the custom MK Workstation Edition watermark badge on the top status panel.",
  "shell-version": ["44", "45", "46", "47"]
}
```

## Custom Indicator Extension extension.js
```
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MKIndicatorExtension extends Extension {
    enable() {
        this._indicator = new St.Label({
            text: '⚡ MK Workstation',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-button'
        });
        Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
```

## Repository Git Status & Tree
```
 M register-face.sh
 M setup.sh
?? FEDORA_MK_FULL_CONTEXT.md
?? generate_system_context.sh
.
├── AI_PROMPT_TEMPLATE.md
├── apps
│   ├── dnf-packages.txt
│   └── flatpaks.txt
├── bin
│   ├── close-workspace-apps
│   ├── fix-alt-tab
│   ├── ocr-snip
│   └── show-shortcuts
├── config
│   ├── enabled-extensions.txt
│   ├── gnome-desktop-full.dconf
│   ├── gnome-media-keys.dconf
│   ├── gnome-mutter-full.dconf
│   ├── gnome-shell-full.dconf
│   └── keybindings.dconf
├── dconf
├── extensions
│   ├── blur-my-shell@aunetx
│   │   ├── components
│   │   ├── conveniences
│   │   ├── dbus
│   │   ├── effects
│   │   ├── extension.js
│   │   ├── icons
│   │   ├── LICENSE
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── pipelines
│   │   ├── preferences
│   │   ├── prefs.js
│   │   ├── render
│   │   ├── schemas
│   │   ├── settings
│   │   ├── stylesheet.css
│   │   └── ui
│   ├── burn-my-windows@schneegans.github.com
│   │   ├── extension.js
│   │   ├── LICENSE
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── resources
│   │   ├── schemas
│   │   └── src
│   ├── caffeine@patapon.info
│   │   ├── extension.js
│   │   ├── icons
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── mprisMediaPlayer2.js
│   │   ├── preferences
│   │   ├── prefs.js
│   │   └── schemas
│   ├── clipboard-indicator@tudmotu.com
│   │   ├── confirmDialog.js
│   │   ├── constants.js
│   │   ├── extension.js
│   │   ├── keyboard.js
│   │   ├── LICENSE.rst
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── registry.js
│   │   ├── schemas
│   │   └── stylesheet.css
│   ├── compiz-alike-magic-lamp-effect@hermes83.github.com
│   │   ├── extension.js
│   │   ├── LICENSE
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   └── settings_data.js
│   ├── compiz-windows-effect@hermes83.github.com
│   │   ├── extension.js
│   │   ├── LICENSE
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   ├── settings_data.js
│   │   └── src
│   ├── ding@rastersoft.com
│   │   ├── app
│   │   ├── emulateX11WindowType.js
│   │   ├── extension.js
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   └── visibleArea.js
│   ├── just-perfection-desktop@just-perfection
│   │   ├── CHANGELOG.md
│   │   ├── extension.js
│   │   ├── lib
│   │   ├── LICENSE
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── resources.gresource
│   │   ├── schemas
│   │   └── stylesheet.css
│   ├── macos-dock@vinnytherobot.github.io
│   │   ├── extension.js
│   │   ├── lib
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   └── stylesheet.css
│   ├── mk-indicator@mehulk
│   │   ├── extension.js
│   │   └── metadata.json
│   ├── monitor@astraext.github.io
│   │   ├── extension.js
│   │   ├── icons
│   │   ├── LICENSE
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── README.md
│   │   ├── RELEASES.md
│   │   ├── schemas
│   │   ├── src
│   │   └── stylesheet.css
│   ├── quick-settings-tweaks@qwreey
│   │   ├── config.js
│   │   ├── extension.js
│   │   ├── features
│   │   ├── global.js
│   │   ├── libs
│   │   ├── locale
│   │   ├── media
│   │   ├── metadata.json
│   │   ├── prefPages
│   │   ├── prefs.js
│   │   ├── schemas
│   │   └── stylesheet.css
│   ├── screenshot-ocr@nbubis.github.com
│   │   ├── extension.js
│   │   └── metadata.json
│   ├── tiling-assistant@leleat-on-github
│   │   ├── extension.js
│   │   ├── locale
│   │   ├── media
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   ├── src
│   │   └── stylesheet.css
│   ├── touchpad-gesture-customization@coooolapps.com
│   │   ├── assets
│   │   ├── common
│   │   ├── constants.js
│   │   ├── extension.js
│   │   ├── metadata.json
│   │   ├── prefs
│   │   ├── prefs.js
│   │   ├── schemas
│   │   ├── src
│   │   ├── stylesheet.css
│   │   └── ui
│   ├── transparent-top-bar@ftpix.com
│   │   ├── extension.js
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   └── stylesheet.css
│   ├── wack-lockscreen-clock@rinzler69-wastaken.github.com
│   │   ├── extension.js
│   │   ├── LICENSE
│   │   ├── locale
│   │   ├── metadata.json
│   │   ├── prefs.js
│   │   ├── schemas
│   │   ├── src
│   │   └── stylesheet.css
│   └── wack-shell@rinzler69-wastaken.github.com
│       ├── alphaCache.js
│       ├── colorManager.js
│       ├── constants.js
│       ├── extension.js
│       ├── LICENSE
│       ├── metadata.json
│       ├── panelBlur.js
│       ├── panelComponents.js
│       ├── prefs.js
│       ├── README.md
│       ├── README.txt
│       ├── Resources
│       ├── schemas
│       ├── scripts
│       ├── STATIC_PANEL_BLUR_README.txt
│       ├── stylesheet.css
│       ├── stylesheet-custom.css
│       ├── vibrancyManager.js
│       ├── wallpaperSampler.js
│       └── wallpaperUtils.js
├── FEDORA_MK_FULL_CONTEXT.md
├── fedora-workstation-config.spec
├── generate_system_context.sh
├── LICENSE
├── README.md
├── register-face.sh
├── scripts
│   └── update-repo.sh
├── setup.sh
└── sync.sh

85 directories, 122 files
```

## Local setup.sh
```
#!/usr/bin/env bash
set -e

echo "================================================="
echo "   Installing Fedora MK Workstation Edition     "
echo "================================================="

REAL_USER=${SUDO_USER:-$USER}
REAL_UID=$(id -u "$REAL_USER")
USER_HOME=$(eval echo "~$REAL_USER")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# gsettings/gnome-extensions talk to the user's session over DBus. Under sudo
# that bus address is lost, so pass it explicitly or writes silently go nowhere.
USER_BUS="/run/user/$REAL_UID/bus"
as_user() {
    sudo -u "$REAL_USER" env \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_BUS" \
        XDG_RUNTIME_DIR="/run/user/$REAL_UID" \
        "$@"
}
user_gsettings() { as_user gsettings "$@"; }

# Set a key under [main] in dnf.conf, replacing it if already present.
DNF_CONF=/etc/dnf/dnf.conf
set_dnf_opt() {
    local key=$1 val=$2
    if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$DNF_CONF"; then
        sudo sed -i -E "s|^[[:space:]]*${key}[[:space:]]*=.*|${key}=${val}|" "$DNF_CONF"
    else
        sudo sed -i "/^\[main\]/a ${key}=${val}" "$DNF_CONF"
    fi
}

echo "==> [1/8] Optimizing DNF..."
[ -f "$DNF_CONF.bak" ] || sudo cp -a "$DNF_CONF" "$DNF_CONF.bak"
grep -q '^\[main\]' "$DNF_CONF" || echo '[main]' | sudo tee -a "$DNF_CONF" >/dev/null
set_dnf_opt max_parallel_downloads 10
set_dnf_opt fastestmirror True

echo "==> [2/8] Enabling RPM Fusion Repositories..."
FEDORA_VER=$(rpm -E %fedora)
if ! rpm -q rpmfusion-free-release rpmfusion-nonfree-release >/dev/null 2>&1; then
    sudo dnf install -y \
        "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VER}.noarch.rpm" \
        "https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${FEDORA_VER}.noarch.rpm"
else
    echo "    RPM Fusion already enabled."
fi

echo "==> [3/8] Installing Packages via DNF..."
sudo dnf copr enable -y principis/howdy || true
sudo dnf install -y --skip-unavailable \
    wmctrl \
    wtype \
    tesseract \
    gnome-shell-extension-dash-to-dock \
    extension-manager \
    gnome-tweaks \
    howdy || true

echo "==> [4/8] Configuring Flathub & Core Flatpaks..."
sudo flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
sudo flatpak install --system -y flathub com.github.tenderowl.frog || true

echo "==> [5/8] Deploying MK Indicator Extension..."
as_user mkdir -p "$USER_HOME/.local/share/gnome-shell/extensions"
if [ -d "$SCRIPT_DIR/extensions/mk-indicator@mehulk" ]; then
    cp -r "$SCRIPT_DIR/extensions/mk-indicator@mehulk" "$USER_HOME/.local/share/gnome-shell/extensions/"
    chown -R "$REAL_USER:$REAL_USER" "$USER_HOME/.local/share/gnome-shell/extensions/mk-indicator@mehulk"
fi

if [ ! -S "$USER_BUS" ]; then
    echo "⚠ No session bus at $USER_BUS — is $REAL_USER logged into GNOME?"
    echo "  Skipping GNOME settings. Log in graphically and re-run this script."
    exit 0
fi

echo "==> [6/8] Configuring User Preferences & Alt+Tab..."
user_gsettings set org.gnome.shell disable-user-extensions false
user_gsettings set org.gnome.desktop.wm.keybindings switch-applications "[]"
user_gsettings set org.gnome.desktop.wm.keybindings switch-applications-backward "[]"
user_gsettings set org.gnome.desktop.wm.keybindings switch-windows "['<Alt>Tab']"
user_gsettings set org.gnome.desktop.wm.keybindings switch-windows-backward "['<Shift><Alt>Tab']"
user_gsettings set org.gnome.shell.app-switcher current-workspace-only false

echo "==> [7/8] Restoring Screenshot Key & Dock Workspace Isolation..."
user_gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "[]"
user_gsettings set org.gnome.shell.keybindings show-screenshot-ui "['Print']"

user_gsettings set org.gnome.shell.extensions.dash-to-dock isolate-workspaces true 2>/dev/null || true
user_gsettings set org.gnome.shell.extensions.dash-to-dock isolate-monitors true 2>/dev/null || true

echo "==> [8/8] Enabling GNOME Extensions..."
as_user gnome-extensions enable dash-to-dock@micxgx.gmail.com 2>/dev/null || true
as_user gnome-extensions enable mk-indicator@mehulk 2>/dev/null || true

echo "================================================="
echo "✔ MK Workstation Edition deployment complete!   "
echo "================================================="
```

## Local register-face.sh
```
#!/usr/bin/env bash
set -e

echo "================================================="
echo "   MK Workstation - Howdy Face Scan Setup       "
echo "================================================="

PAM_FILES=(/etc/pam.d/gdm-password /etc/pam.d/sudo)
HOWDY_LINE="auth        sufficient    pam_howdy.so"

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

echo "==> Enabling Howdy in PAM (gdm-password, sudo)..."
if [ ! -e /usr/lib64/security/pam_howdy.so ] && [ ! -e /usr/lib/security/pam_howdy.so ]; then
    echo "⚠ pam_howdy.so not found — skipping PAM changes to avoid breaking login."
else
    for pam in "${PAM_FILES[@]}"; do
        if [ ! -f "$pam" ]; then
            echo "    $pam not present, skipping."
        elif sudo grep -qE '^[[:space:]]*auth[[:space:]].*pam_howdy\.so' "$pam"; then
            echo "    $pam already configured."
        else
            # Keep the pristine original; never overwrite an existing backup.
            [ -f "$pam.bak" ] || sudo cp -a "$pam" "$pam.bak"
            # Drop stale Howdy 2.x hooks (pam_python + howdy/pam.py); 3.x replaces them.
            sudo sed -i -E '/^[[:space:]]*auth[[:space:]].*pam_python\.so.*howdy/d' "$pam"
            # Insert before the first auth line so face auth is tried first.
            sudo sed -i "0,/^auth/s//${HOWDY_LINE}\n&/" "$pam"
            echo "    $pam updated (backup: $pam.bak)."
        fi
    done
fi

echo "==> Testing Face Recognition (Press Ctrl+C to exit test)..."
sudo howdy test || true

echo "✔ Facial recognition setup complete!"
```

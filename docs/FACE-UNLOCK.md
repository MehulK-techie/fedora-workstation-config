# Face Unlock

Unlock the login screen (and optionally `sudo`) by looking at your camera. It uses [Howdy](https://github.com/boltgolt/howdy) and runs entirely on your computer; nothing is uploaded. **Your password always keeps working.**

---

## Set it up in three steps

1. Make sure your face is lit from the front (a lamp or screen in front of you, not a window behind you).
2. Open **Terminal** and run:

   ```bash
   mk face
   ```

   (Or, from the repo folder, `sudo ./register-face.sh`.) Type your password when asked.
3. Follow the prompts. The wizard asks you to look at the camera three times, each in different lighting:

   | Model | What to do |
   | :--- | :--- |
   | 1. Normal light | Sit the way you usually do, in your normal room light. |
   | 2. Dim light | Switch off the main light or close the curtains. |
   | 3. Bright or side light | Sit near a window or lamp, or put on glasses if you wear them. |

   Press **Enter** to record each one, **s** to skip one, or **q** to stop early.

Then test it: lock the screen with **Super + L** and look at the camera.

---

## Why three models (and how lighting is handled)

Howdy compares your face against **every** model you recorded and accepts the closest match. A model recorded in dim light is what lets unlock work at night; one recorded by a window covers bright days. More lighting variety means fewer failed unlocks, with no loss of security.

The wizard also adapts to your camera and room:

- **Checks the light** before each recording on a regular webcam, and tells you if it's too dark or backlit (brightness 0–255; 70–190 is ideal).
- **Turns on the camera's automatic exposure**, so the picture brightens or darkens with the room.
- **Tunes Howdy for your camera type.** Howdy throws away frames that are too dark. A regular webcam in a dim room sees mostly dark frames, so it gets a higher darkness limit (`dark_threshold = 80`) and a bit more time (`timeout = 4`). IR cameras light your face themselves and keep the defaults (`60`, `3`).
- **Stricter than Howdy's default.** `certainty` is 2.6 on every camera, and `dark_threshold` 50 (more dim frames are skipped: in a dark room it may say "no face found" until there's more light) (Howdy's default is 3.5; lower is stricter), so look-alikes are refused more often. Reliability comes from the extra models, not from accepting weaker matches. Howdy has no liveness check: a regular webcam can still be fooled by a good photo; an IR camera can't easily.

Howdy itself can't change its settings on the fly while unlocking. Multiple lighting models plus auto-exposure is how this setup copes with changing light.

---

## More than one face

| I want to… | Run |
| :--- | :--- |
| Add one more model for myself (new glasses, new lighting) | `mk face --models 1` |
| Record five models (up to 5) | `mk face --models 5` |
| Let another person on this computer use face unlock | `mk face --user THEIR_USERNAME` |
| See my models | `sudo howdy -U "$USER" list` |
| Remove one model | `sudo howdy -U "$USER" remove <id>` (the id comes from `list`) |
| Start over | `sudo howdy -U "$USER" clear`, then `mk face` |

Each person can only unlock **their own** account. Another person's face never opens yours.

---

## Security: IR camera vs regular webcam

| | IR camera (Windows Hello type) | Regular webcam |
| :--- | :--- | :--- |
| Works in the dark | Yes | Needs some light |
| Can a printed photo fool it? | Very hard | Possibly |
| Login screen | Enabled | Enabled |
| `sudo` (admin commands) | Enabled | **Only if you answer yes.** Answering no also removes it if it was enabled before. |

The wizard picks an IR camera automatically when your computer has one. On laptops with only a regular webcam (for example the HP Wide Vision HD), it warns you and keeps `sudo` password-only unless you choose otherwise.

### Add a face from the Control Center (you, or a guest)

MK Control Center › MK Lock › Face & Fingerprint › **Add a face**: pick
*You (primary)* or *Guest*, keep or change the model's name (`primary_model`,
`guest`) and press Record. A terminal window titled *Face Enrollment* runs
`mk-face-add`, which calls Howdy directly (`howdy -y -U YOU add NAME`, under one `sudo` for the whole run):
sudo asks for your password once (one face scan, not one per command), it asks before replacing a model with the
same name (the new one is recorded first) and before closing an app that
holds the camera, and it gives up after 30 s instead of hanging. Existing
models are never cleared. Then press **Try Face ID**. A guest's face
unlocks **your** account (login, sudo, locked apps): remove it after the
demo with **Remove this model** (the same name), or `mk-face-add NAME --remove`.

**Enroll a finger** in the same tab: for you or another account, and which
finger; a finger that's already enrolled is only scanned again if you say
so. A ring fills with each accepted touch, as many as your reader needs
(fprintd's `num-enroll-stages`: 11 on a Synaptics 06cb:00e7, not 5); a
missed touch shows an amber "Center your finger and hold it firm" and keeps
listening. It talks to fprintd over D-Bus directly and always releases the
reader (done, failed or closed). Enrolling
someone else asks for an administrator (fprintd's own rule).

### In MK's own apps

MK Notes' lock, locked apps, locked folders and the vault all use one unlock
window: a cyan ring looks for your face the moment it opens, a password field
sits underneath, and the fingerprint hint only appears when a reader with an
enrolled finger is connected. The check runs as root in `mk-face-auth`
(socket-activated, `/run/mk-face-auth.sock`), for the user who asked only.

- **Locked apps:** your face, your fingerprint, the app's own password, or
  your account password in the system prompt. Locking **and** unlocking an
  app (`mk-lock app add|remove`, or the switch in Control Center) ask the
  same first; cancelled, nothing changes and the switch goes back.
- **What's enrolled:** `mk biometrics list-faces` (ID, date, label of each
  Face ID model; sudo once, Howdy's models are root's) and
  `mk biometrics list-fingers`; Control Center › Biometrics has List face
  models and the Enrolled fingers list.
- **Locked folders and the vault:** the folder's own password, or **Use the
  system prompt…** (fingerprint or account password, through polkit). Face ID
  never opens a folder: `mk-face-auth` answers yes or no to any program
  running as you, so a match could be triggered without you noticing while
  you sit at the camera. A key needs a prompt you can see.
- Passwords are never checked by `mk-face-auth`: a root service that tried
  passwords for any caller would be a guessing oracle.

---

## Everyday commands

| Task | Command |
| :--- | :--- |
| Pause face unlock | `sudo howdy disable 1` |
| Turn it back on | `sudo howdy disable 0` |
| Re-tune after changing camera or lighting setup | `mk face --tune-only` |
| See the camera's view and match scores | `sudo howdy -U "$USER" test` (close with Ctrl+C) |
| Check whether it's enabled | `mk doctor` |

---

## Troubleshooting

| Problem | Fix |
| :--- | :--- |
| "No face model was recorded" | Light your face from the front and run `mk face` again. |
| Works by day, fails at night | Add a dim-light model: `mk face --models 1` in the dark room, choosing *Dim light*. |
| Fails with glasses or a hat | Add a model wearing them: `mk face --models 1`. |
| Takes a long time, then asks for the password | Move closer to the camera and check `mk doctor`. With a webcam, add light in front of you. |
| "All frames were too dark" in `howdy test` | Run `mk face --tune-only`, or raise `dark_threshold` in `/etc/howdy/config.ini` by 5–10. |
| Camera not found | Run `v4l2-ctl --list-devices`. If your camera is listed, run `mk face --tune-only` and pick it. |
| Stopped working after a Fedora upgrade | Run `mk face --tune-only`. |
| Turn it off completely | `sudo sed -i '/pam_howdy\.so/d' /etc/pam.d/sudo /etc/pam.d/gdm-password` |
| Can't log in at all | Your password always works. If the login screen itself is broken, press `Ctrl+Alt+F3`, log in, run the command above, then reboot. |

The wizard backs up every file it changes before the first edit: `/etc/howdy/config.ini.bak`, `/etc/pam.d/gdm-password.bak` and `/etc/pam.d/sudo.bak`.

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
- **Never loosens matching.** `certainty` stays at Howdy's strict default of 3.5 on every camera. Reliability comes from the extra models, not from accepting weaker matches.

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

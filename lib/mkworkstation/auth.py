"""Confirm it's you: one unlock dialog for MK's own apps (MK Notes, MK Lock).

UnlockDialog, Windows Hello style: a glowing scanner ring over a PIN field
that's always there.
  - Face ID starts the moment it opens (cyan ring, "Looking for your face"):
    the root helper mk-face-auth (socket /run/mk-face-auth.sock, installed by
    setup.sh) checks the calling user's own face with Howdy;
  - fingerprint, read in the app through fprintd (net.reactivated.Fprint),
    listens at the same time when a reader with an enrolled finger exists;
  - the system check (polkit, the action mk-lock installs): GNOME's own prompt;
  - the PIN or password typed in the field, checked by the caller.

PINs are stored salted (scrypt); older unsalted SHA-256 hashes still match
and should be upgraded by the caller (pin_needs_upgrade).
"""
import base64
import getpass
import hashlib
import hmac
import math
import os
import secrets
import shutil
import socket
import subprocess
import threading
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gio, GLib, Gtk  # noqa: E402

POLKIT_ACTION = "io.github.mehulk.mk-lock.unlock"
POLKIT_POLICY = Path("/usr/share/polkit-1/actions/io.github.mehulk.mk-lock.policy")
FPRINT = "net.reactivated.Fprint"
FACE_SOCKET = "/run/mk-face-auth.sock"


# ---------------------------------------------------------------- PINs
def hash_pin(pin):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def check_pin(pin, stored):
    if not stored:
        return False
    if stored.startswith("scrypt$"):
        try:
            _, salt, digest = stored.split("$")
            want = base64.b64decode(digest)
            got = hashlib.scrypt(pin.encode(), salt=base64.b64decode(salt), n=2 ** 14, r=8, p=1)
        except ValueError:
            return False
        return hmac.compare_digest(got, want)
    return hmac.compare_digest(hashlib.sha256(pin.encode()).hexdigest(), stored)


def pin_needs_upgrade(stored):
    return bool(stored) and not stored.startswith("scrypt$")


# ---------------------------------------------------------------- system check
def system_check_available():
    return bool(shutil.which("pkcheck")) and POLKIT_POLICY.exists()


def confirm_with_system(callback):
    """polkit asks (fingerprint or password) in GNOME's prompt; callback(ok)
    runs on the main loop. Never blocks the window."""
    def work():
        ok = subprocess.run(["pkcheck", "--action-id", POLKIT_ACTION, "--process", str(os.getpid()),
                             "--allow-user-interaction"], stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL).returncode == 0
        GLib.idle_add(callback, ok)
    threading.Thread(target=work, daemon=True).start()


# ---------------------------------------------------------------- face
def face_available():
    return os.path.exists(FACE_SOCKET)


def check_face(callback):
    """Ask mk-face-auth whether the face at the camera is ours; callback(ok,
    message) on the main loop. Never blocks the window."""
    def work():
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(25)
                conn.connect(FACE_SOCKET)
                reply = conn.makefile().readline().strip()
        except OSError as err:
            reply = f"NO {err.strerror or 'Face ID unavailable'}"
        ok = reply == "OK"
        message = "Face ID is busy; try again in a moment" if reply == "BUSY" else reply[3:]
        GLib.idle_add(callback, ok, message)
    threading.Thread(target=work, daemon=True).start()


# ---------------------------------------------------------------- fingerprint
class FingerprintListener:
    """Waits for an enrolled finger on the default reader. on_status(state):
    'listening', 'retry', 'match', 'no-match' or 'unavailable'."""

    def __init__(self, on_status):
        self.on_status = on_status
        self.device = None
        self.claimed = False

    @staticmethod
    def _proxy(path, iface):
        return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, None,
                                              FPRINT, path, iface, None)

    def start(self):
        try:
            manager = self._proxy("/net/reactivated/Fprint/Manager", FPRINT + ".Manager")
            path = manager.call_sync("GetDefaultDevice", None, Gio.DBusCallFlags.NONE, 2000, None).unpack()[0]
            self.device = self._proxy(path, FPRINT + ".Device")
            fingers = self.device.call_sync("ListEnrolledFingers", GLib.Variant("(s)", (getpass.getuser(),)),
                                            Gio.DBusCallFlags.NONE, 2000, None).unpack()[0]
            if not fingers:
                raise GLib.Error("no finger enrolled")
            self.device.connect("g-signal", self._on_signal)
            self.device.call_sync("Claim", GLib.Variant("(s)", ("",)), Gio.DBusCallFlags.NONE, 3000, None)
            self.claimed = True
            self._verify()
        except GLib.Error:
            self.stop()
            self.on_status("unavailable")
            return False
        return True

    def _verify(self):
        self.device.call("VerifyStart", GLib.Variant("(s)", ("any",)), Gio.DBusCallFlags.NONE, 3000, None, None)
        self.on_status("listening")

    def _on_signal(self, _proxy, _sender, signal, params):
        if signal != "VerifyStatus" or not self.claimed:
            return
        result, done = params.unpack()
        if result == "verify-match":
            self.stop()
            self.on_status("match")
        elif done:
            self.on_status("no-match" if result == "verify-no-match" else "retry")

            def restart(proxy, res):
                try:
                    proxy.call_finish(res)
                except GLib.Error:
                    pass
                if self.claimed:
                    self._verify()
            self.device.call("VerifyStop", None, Gio.DBusCallFlags.NONE, 5000, None, restart)
        else:
            self.on_status("retry")

    def stop(self):
        """Release the reader without waiting: fprintd can take seconds to
        answer, and this runs on the window's main loop."""
        if self.device and self.claimed:
            self.claimed = False
            device = self.device

            def release(proxy, result):
                try:
                    proxy.call_finish(result)
                except GLib.Error:
                    pass
                device.call("Release", None, Gio.DBusCallFlags.NONE, 5000, None, None)
            device.call("VerifyStop", None, Gio.DBusCallFlags.NONE, 5000, None, release)


# ---------------------------------------------------------------- the ring
class ScannerRing(Gtk.DrawingArea):
    """A glowing ring: it breathes and sweeps while listening, turns green on
    success and red when a check fails."""

    def __init__(self, size=112):
        super().__init__(content_width=size, content_height=size, halign=Gtk.Align.CENTER)
        self.state = "idle"
        self.face = False  # True while Face ID looks: cyan, a face inside
        self.phase = 0.0
        self._tick = 0
        self.set_draw_func(self._draw)

    def set_state(self, state):
        self.state = state
        if state == "listening" and not self._tick:
            self._tick = self.add_tick_callback(self._advance)
        elif state != "listening" and self._tick:
            self.remove_tick_callback(self._tick)
            self._tick = 0
        self.queue_draw()

    def _advance(self, _widget, clock):
        self.phase = (clock.get_frame_time() / 1_000_000) % 2.0
        self.queue_draw()
        return GLib.SOURCE_CONTINUE

    def _colour(self):
        if self.state == "match":
            return (0.30, 0.80, 0.45)
        if self.state == "fail":
            return (0.93, 0.33, 0.33)
        if self.face:
            return (0.20, 0.85, 0.95)
        try:
            c = Adw.StyleManager.get_default().get_accent_color_rgba()
            return (c.red, c.green, c.blue)
        except AttributeError:
            return (0.21, 0.52, 0.89)

    def _draw(self, _area, cr, w, h):
        r, g, b = self._colour()
        cx, cy = w / 2, h / 2
        radius = min(w, h) / 2 - 10
        breathe = (math.sin(self.phase * math.pi) + 1) / 2 if self.state == "listening" else 0.6
        for i in range(6, 0, -1):  # soft glow: wide faint strokes under the ring
            cr.set_source_rgba(r, g, b, 0.05 * breathe * (7 - i) / 6)
            cr.set_line_width(4 + i * 3)
            cr.arc(cx, cy, radius, 0, 2 * math.pi)
            cr.stroke()
        cr.set_source_rgba(r, g, b, 0.35 + 0.4 * breathe)
        cr.set_line_width(3)
        cr.arc(cx, cy, radius, 0, 2 * math.pi)
        cr.stroke()
        if self.state == "listening":
            start = self.phase * math.pi
            cr.set_source_rgba(r, g, b, 0.95)
            cr.set_line_width(4)
            cr.arc(cx, cy, radius, start, start + math.pi / 2.5)
            cr.stroke()
        # The symbol inside: a fingerprint's arcs, or a tick when it matched.
        cr.set_source_rgba(r, g, b, 0.9)
        cr.set_line_width(2.2)
        if self.state == "match":
            cr.move_to(cx - 14, cy + 1)
            cr.line_to(cx - 4, cy + 11)
            cr.line_to(cx + 16, cy - 11)
            cr.stroke()
            return
        if self.face:  # a face: outline, eyes, smile
            cr.arc(cx, cy, 20, 0, 2 * math.pi)
            cr.stroke()
            for ex in (-7, 7):
                cr.arc(cx + ex, cy - 5, 1.8, 0, 2 * math.pi)
                cr.fill()
            cr.arc(cx, cy + 2, 9, math.pi * 0.2, math.pi * 0.8)
            cr.stroke()
            return
        for k in range(4):
            rr = 6 + k * 6
            cr.arc(cx, cy + 6, rr, math.pi * 1.1, math.pi * 1.9 + (0.25 if k % 2 else 0))
            cr.stroke()


# ---------------------------------------------------------------- the dialog
class UnlockDialog(Adw.Dialog):
    """check(secret) returns True, False (wrong) or a message to show (e.g. a
    too-short new PIN). on_success() runs once, after the dialog closes.
    creating=True asks for a new PIN instead (no fingerprint: there's no PIN
    to fall back on yet)."""

    def __init__(self, heading, check, on_success, creating=False, placeholder=None):
        super().__init__(title=heading, content_width=360, follows_content_size=True)
        self.check = check
        self.on_success = on_success
        self.done = False
        self.finger = None
        self.finger_on = False   # a reader with an enrolled finger is listening
        self.face_state = None   # None, "looking" or "missed"

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12,
                      margin_top=18, margin_bottom=24, margin_start=24, margin_end=24)
        self.ring = ScannerRing()
        box.append(self.ring)
        self.status = Gtk.Label(wrap=True, justify=Gtk.Justification.CENTER, css_classes=["dim-label"])
        box.append(self.status)
        self.entry = Gtk.PasswordEntry(show_peek_icon=True, hexpand=True,
                                       placeholder_text=placeholder or ("Create a PIN (4+ characters)" if creating
                                                                        else "PIN or password"))
        self.entry.connect("activate", self._submit)
        self.entry.connect("changed", lambda *_: self.error.set_visible(False))
        self.error = Gtk.Label(css_classes=["error"], visible=False, xalign=0)
        unlock = Gtk.Button(label="Set PIN" if creating else "Unlock", css_classes=["suggested-action", "pill"])
        unlock.connect("clicked", self._submit)
        box.append(self.entry)
        box.append(self.error)
        box.append(unlock)
        self.retry_face = Gtk.Button(label="Try Face ID again", css_classes=["flat"], visible=False)
        self.retry_face.connect("clicked", lambda *_: self._start_face())
        box.append(self.retry_face)
        if not creating and system_check_available():
            system = Gtk.Button(label="Use the system prompt…", css_classes=["flat"])
            system.connect("clicked", self._system_check)
            box.append(system)

        view = Adw.ToolbarView(content=box)
        view.add_top_bar(Adw.HeaderBar())
        self.set_child(view)
        self.connect("closed", lambda *_: self.finger and self.finger.stop())

        if creating:
            self.status.set_label("Choose a PIN. You'll type it to unlock.")
            GLib.idle_add(lambda: self.entry.grab_focus() and False)  # once: True would repeat it forever
        else:
            self._say()
            if face_available():
                GLib.idle_add(self._start_face)
            self.finger = FingerprintListener(self._on_finger)
            GLib.idle_add(self._start_finger)

    def _say(self):
        """The line under the ring, from what's listening right now."""
        looking = self.face_state == "looking"
        rest = "Touch the reader or type your PIN." if self.finger_on else "Type your PIN."
        self.status.set_label(f"Looking for your face…\n{rest}" if looking else rest)
        self.ring.face = self.face_state == "looking"
        self.ring.set_state("listening" if self.face_state == "looking" or self.finger_on else "idle")

    def _start_face(self):
        if self.done or self.face_state == "looking":
            return False
        self.face_state = "looking"
        self.retry_face.set_visible(False)
        self._say()
        check_face(self._on_face)
        return False

    def _on_face(self, ok, message):
        if self.done:
            return False
        if ok:
            self.ring.face = True
            self._succeed()
            return False
        self.face_state = "missed"
        self.retry_face.set_visible(True)
        self._say()
        if message and "no face enrolled" not in message:
            self.error.set_label(f"Face ID: {message}")
            self.error.set_visible(True)
        return False

    def _start_finger(self):
        self.finger.start()
        self.entry.grab_focus()
        return False

    def _on_finger(self, state):
        if self.done:
            return
        if state == "listening":
            self.finger_on = True
            self._say()
        elif state == "retry":
            self.status.set_label("Didn't catch that: touch the reader again.")
        elif state == "no-match":
            self._fail("That finger didn't match. Try again or type your PIN.")
            GLib.timeout_add(900, lambda: (not self.done and self._say(), False)[1])
        elif state == "match":
            self._succeed()
        else:
            self.finger_on = False
            self._say()

    def _system_check(self, _button):
        self.status.set_label("Confirm in the system prompt…")
        if self.finger:
            self.finger.stop()  # the system prompt may want the reader too
        confirm_with_system(lambda ok: self._succeed() if ok else self._fail("Not confirmed."))

    def _submit(self, *_):
        secret = self.entry.get_text()
        if not secret:
            return
        result = self.check(secret)
        if result is True:
            self._succeed()
        else:
            self.entry.set_text("")  # before _fail: a change hides the error
            self._fail(result if isinstance(result, str) else "Wrong PIN. Try again.")
            self.entry.grab_focus()

    def _fail(self, message):
        self.ring.set_state("fail")
        self.error.set_label(message)
        self.error.set_visible(True)
        self._shake()

    def _shake(self):
        def nudge(v):
            offset = round(8 * math.sin(v * math.pi * 6) * (1 - v))
            self.entry.set_margin_start(max(0, offset))
            self.entry.set_margin_end(max(0, -offset))
        anim = Adw.TimedAnimation.new(self.entry, 0.0, 1.0, 360, Adw.CallbackAnimationTarget.new(nudge))
        anim.connect("done", lambda *_: nudge(1.0))
        anim.play()

    def _succeed(self):
        if self.done:
            return False
        self.done = True
        if self.finger:
            self.finger.stop()
        self.ring.set_state("match")
        self.status.set_label("Unlocked")
        GLib.timeout_add(350, lambda: (self.close(), self.on_success(), False)[2])
        return False


def present_unlock(parent, heading, check, on_success, creating=False):
    dialog = UnlockDialog(heading, check, on_success, creating=creating)
    dialog.present(parent)
    return dialog


"""Wi-Fi, Bluetooth and Airplane mode, each on its own.

GNOME (gnome-settings-daemon's rfkill plugin) shows Airplane mode whenever
every radio is rfkill-blocked, and GNOME's own Bluetooth switch turns
Bluetooth off by blocking it. So with Bluetooth off that way, switching
Wi-Fi off made the top bar show the Airplane icon. Here:

  * Wi-Fi goes on and off through NetworkManager (WirelessEnabled) only.
    Before Wi-Fi goes off, a blocked Bluetooth is unblocked and powered
    off in BlueZ instead: still off, but not every radio is blocked, so
    GNOME doesn't call it Airplane mode.
  * Bluetooth goes on and off through BlueZ (Adapter1.Powered), unblocked
    first if it has to be.
  * Airplane mode notes what Wi-Fi and Bluetooth were
    ($XDG_RUNTIME_DIR/mk-radio-state.json), then lets GNOME block them all;
    turning it off puts each back as it was, rather than everything on.

All calls block (D-Bus round trips): run them off the main loop.
"""
import json
import os
import time
from pathlib import Path

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

STATE = Path(os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}") / "mk-radio-state.json"
NM = ("org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager", "org.freedesktop.NetworkManager")
GSD = ("org.gnome.SettingsDaemon.Rfkill", "/org/gnome/SettingsDaemon/Rfkill", "org.gnome.SettingsDaemon.Rfkill")


class Bus:
    """The D-Bus calls, kept apart so tests can stand in for them."""

    def __init__(self):
        self.system = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        self.session = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def get(self, conn, where, prop):
        name, path, iface = where
        reply = conn.call_sync(name, path, "org.freedesktop.DBus.Properties", "Get",
                               GLib.Variant("(ss)", (iface, prop)), GLib.VariantType("(v)"),
                               Gio.DBusCallFlags.NONE, 5000, None)
        return reply.unpack()[0]

    def set(self, conn, where, prop, value):
        name, path, iface = where
        conn.call_sync(name, path, "org.freedesktop.DBus.Properties", "Set",
                       GLib.Variant("(ssv)", (iface, prop, GLib.Variant("b", value))), None,
                       Gio.DBusCallFlags.NONE, 5000, None)

    def adapter(self):
        """BlueZ's first adapter, as a (name, path, interface) triple, or None."""
        reply = self.system.call_sync("org.bluez", "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects",
                                      None, None, Gio.DBusCallFlags.NONE, 5000, None)
        for path, ifaces in reply.unpack()[0].items():
            if "org.bluez.Adapter1" in ifaces:
                return ("org.bluez", path, "org.bluez.Adapter1")
        return None


class Radios:
    def __init__(self, bus=None):
        self.bus = bus or Bus()

    # ---------- reading
    def wifi_on(self):
        return bool(self.bus.get(self.bus.system, NM, "WirelessEnabled"))

    def bt_blocked(self):
        return bool(self.bus.get(self.bus.session, GSD, "BluetoothAirplaneMode"))

    def bt_on(self):
        adapter = self.bus.adapter()
        return bool(adapter) and not self.bt_blocked() and bool(self.bus.get(self.bus.system, adapter, "Powered"))

    def airplane(self):
        return bool(self.bus.get(self.bus.session, GSD, "AirplaneMode"))

    # ---------- each radio alone
    def set_bluetooth(self, on):
        adapter = self.bus.adapter()
        if adapter is None:
            return
        if self.bt_blocked():
            if not on:
                return  # already off
            self.bus.set(self.bus.session, GSD, "BluetoothAirplaneMode", False)
            time.sleep(0.4)   # BlueZ sees the unblock
        self.bus.set(self.bus.system, adapter, "Powered", on)

    def _unblock_bluetooth_off(self):
        """Bluetooth off by rfkill becomes off in BlueZ, still off."""
        adapter = self.bus.adapter()
        if adapter is None or not self.bt_blocked():
            return
        self.bus.set(self.bus.session, GSD, "BluetoothAirplaneMode", False)
        for _ in range(10):      # an AutoEnable BlueZ powers it on as it's unblocked: off again
            time.sleep(0.15)
            try:
                if self.bus.get(self.bus.system, adapter, "Powered"):
                    break
            except GLib.Error:
                pass
        self.bus.set(self.bus.system, adapter, "Powered", False)

    def set_wifi(self, on):
        if not on:
            self._unblock_bluetooth_off()
        elif self.airplane():
            self.bus.set(self.bus.session, GSD, "AirplaneMode", False)
        self.bus.set(self.bus.system, NM, "WirelessEnabled", on)

    # ---------- Airplane mode, given back as it was
    def set_airplane(self, on):
        if on:
            if not self.airplane():
                STATE.write_text(json.dumps({"wifi": self.wifi_on(), "bluetooth": self.bt_on()}))
            self.bus.set(self.bus.session, GSD, "AirplaneMode", True)
            return
        try:
            before = json.loads(STATE.read_text())
        except (OSError, ValueError):
            before = {"wifi": True, "bluetooth": False}
        self.bus.set(self.bus.session, GSD, "AirplaneMode", False)
        time.sleep(0.4)
        self.set_bluetooth(bool(before.get("bluetooth")))
        self.bus.set(self.bus.system, NM, "WirelessEnabled", bool(before.get("wifi", True)))
        STATE.unlink(missing_ok=True)

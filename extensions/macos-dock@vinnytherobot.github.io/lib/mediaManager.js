import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import { SignalManager } from "./signalManager.js";
const MPRIS_PLAYER_IFACE = "org.mpris.MediaPlayer2.Player";
const MPRIS_PLAYER_PATH = "/org/mpris/MediaPlayer2";
export class MediaManager {
    _signals;
    _bus = null;
    _players = new Map();
    _activePlayer = null;
    _activeApp = null;
    _onStateChanged = null;
    _watchIds = [];
    constructor() {
        this._signals = new SignalManager();
    }
    setOnStateChanged(callback) {
        this._onStateChanged = callback;
    }
    getActiveApp() {
        return this._activeApp;
    }
    isPlaying() {
        return this._activePlayer?.status === "Playing";
    }
    start() {
        this._bus = Gio.DBus.session;
        this._watchNames();
        this._discoverPlayers();
    }
    stop() {
        this._signals.disconnectAll();
        if (this._bus) {
            for (const id of this._watchIds) {
                this._bus.signal_unsubscribe(id);
            }
        }
        this._watchIds = [];
        this._players.clear();
        this._activePlayer = null;
        this._activeApp = null;
    }
    togglePlayPause() {
        if (!this._activePlayer)
            return;
        this._activePlayer.proxy.call("PlayPause", null, Gio.DBusCallFlags.NONE, -1, null, null);
    }
    next() {
        if (!this._activePlayer)
            return;
        this._activePlayer.proxy.call("Next", null, Gio.DBusCallFlags.NONE, -1, null, null);
    }
    previous() {
        if (!this._activePlayer)
            return;
        this._activePlayer.proxy.call("Previous", null, Gio.DBusCallFlags.NONE, -1, null, null);
    }
    _watchNames() {
        if (!this._bus)
            return;
        const signalId = this._bus.signal_subscribe(null, "org.freedesktop.DBus", "NameOwnerChanged", "/org/freedesktop/DBus", null, Gio.DBusSignalFlags.NONE, (_conn, _sender, _path, _iface, _signal, params) => {
            const [name, oldOwner, newOwner] = params.deepUnpack();
            if (name.startsWith("org.mpris.MediaPlayer2")) {
                if (oldOwner && !newOwner) {
                    this._removePlayer(oldOwner);
                }
                else if (!oldOwner && newOwner) {
                    this._addPlayer(name, newOwner);
                }
            }
        });
        this._watchIds.push(signalId);
    }
    _discoverPlayers() {
        if (!this._bus)
            return;
        const bus = this._bus;
        bus.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames", null, new GLib.VariantType("(as)"), Gio.DBusCallFlags.NONE, -1, null, (_connection, res) => {
            let names;
            try {
                [names] = bus.call_finish(res).deepUnpack();
            }
            catch (e) {
                console.error("[macos-dock][media] discover error:", e);
                return;
            }
            for (const name of names) {
                if (name.startsWith("org.mpris.MediaPlayer2")) {
                    this._addPlayer(name, name);
                }
            }
        });
    }
    _addPlayer(busName, uniqueName) {
        if (this._players.has(uniqueName))
            return;
        if (!this._bus)
            return;
        let proxy;
        try {
            proxy = Gio.DBusProxy.new_sync(this._bus, Gio.DBusProxyFlags.NONE, null, busName, MPRIS_PLAYER_PATH, MPRIS_PLAYER_IFACE, null);
        }
        catch (e) {
            console.error(`[macos-dock] Failed to add player ${busName}:`, e);
            return;
        }
        const info = {
            busName,
            uniqueName,
            proxy,
            title: "",
            artist: "",
            status: "Stopped",
            desktopEntry: "",
        };
        this._players.set(uniqueName, info);
        this._updateDesktopEntry(info);
        this._updateMetadata(info);
        this._updatePlaybackStatus(info);
        this._signals.connect(proxy, "g-properties-changed", () => {
            this._updateMetadata(info);
            this._updatePlaybackStatus(info);
            this._pickActivePlayer();
        });
        this._pickActivePlayer();
    }
    _removePlayer(uniqueName) {
        const wasActive = this._players.get(uniqueName) === this._activePlayer;
        this._players.delete(uniqueName);
        if (wasActive) {
            this._activePlayer = null;
            this._pickActivePlayer();
        }
    }
    _pickActivePlayer() {
        let best = null;
        for (const info of this._players.values()) {
            if (info.status === "Playing") {
                best = info;
                break;
            }
        }
        if (!best) {
            for (const info of this._players.values()) {
                if (info.status === "Paused") {
                    best = info;
                    break;
                }
            }
        }
        if (!best && this._players.size > 0) {
            best = this._players.values().next().value ?? null;
        }
        if (this._activePlayer !== best) {
            this._activePlayer = best;
            this._activeApp = this._resolveApp(best);
            this._notify();
        }
    }
    _resolveApp(player) {
        if (!player?.desktopEntry)
            return null;
        const appSystem = Shell.AppSystem.get_default();
        return appSystem.lookup_app(`${player.desktopEntry}.desktop`) ?? null;
    }
    _updateDesktopEntry(info) {
        if (!this._bus)
            return;
        let entry = null;
        try {
            const rootProxy = Gio.DBusProxy.new_sync(this._bus, Gio.DBusProxyFlags.NONE, null, info.busName, MPRIS_PLAYER_PATH, "org.mpris.MediaPlayer2", null);
            entry = rootProxy.get_cached_property("DesktopEntry");
        }
        catch {
            // Fall back to parsing the well-known bus name below.
        }
        if (entry) {
            info.desktopEntry = entry.deepUnpack();
            return;
        }
        const prefix = "org.mpris.MediaPlayer2.";
        if (info.busName.startsWith(prefix)) {
            info.desktopEntry = info.busName.slice(prefix.length);
        }
    }
    _updateMetadata(info) {
        const metadata = info.proxy.get_cached_property("Metadata");
        if (!metadata)
            return;
        const dict = metadata.recursiveUnpack();
        info.title = String(dict["xesam:title"] ?? "");
        const artist = dict["xesam:artist"];
        info.artist = Array.isArray(artist) ? artist.join(", ") : String(artist ?? "");
    }
    _updatePlaybackStatus(info) {
        const status = info.proxy.get_cached_property("PlaybackStatus");
        if (status) {
            info.status = status.deepUnpack();
        }
    }
    _notify() {
        if (this._onStateChanged) {
            this._onStateChanged(this._activeApp);
        }
    }
}

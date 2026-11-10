// MK: is something else playing sound? For the live wallpaper's Background Play,
// which steps aside (fades out) while another app plays and comes back after.
//
// Two sources, and it takes both:
//   - MPRIS players (media.js): any with PlaybackStatus 'Playing' (Spotify, a browser
//     tab with media keys, VLC...), the wallpaper's and the lock screen's own left out
//   - the sound server's playback streams (PipeWire through Gvc, as GNOME's volume
//     menu sees them): any that's open and not idle (a browser closes its stream a
//     few seconds after you pause), leaving out event sounds and the wallpaper's own
// `playing` turns true at once and false only after DEBOUNCE ms of quiet, so a track
// skip or a buffering hiccup doesn't bring the wallpaper back for a moment.
// Emits 'changed' when `playing` changes.
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import { MediaWatcher } from './media.js';

const DEBOUNCE = 600;
// never "other media": the wallpaper's own player (bin/mk-live-wallpaper names its stream; the
// processes it could show up as), the lock screen's video, and sound filters (the B&O speaker
// tuning's own stream, "Speaker (B&O tuning)", is always open: counting it muted the wallpaper
// for good whenever "Mute While Other Media Plays" was on)
const OWN = /live.?wallpaper|LiveLockScreen|wack.?sonoma|\bmpv\b|gst-launch|\bgjs\b|GtkVideo|clutter|B&O tuning|bang.?olufsen|filter-chain|easyeffects/i;

export class OtherMedia extends Signals.EventEmitter {
    constructor() {
        super();
        this.playing = false;
        this._mpris = new MediaWatcher();
        this._mpris.connect('changed', () => this._sync());
        this._mixer = Volume.getMixerControl();
        this._streams = new Map();                     // stream -> its notify::state id
        this._mixerIds = [
            this._mixer.connect('stream-added', (_c, id) => this._watch(this._mixer.lookup_stream_id(id))),
            this._mixer.connect('stream-removed', (_c, id) => this._unwatch(id)),
            this._mixer.connect('state-changed', () => this._watchAll()),
        ];
        this._watchAll();
    }

    _watchAll() {
        if (this._mixer.get_state() !== Gvc.MixerControlState.READY)
            return;
        for (const stream of this._mixer.get_sink_inputs())
            this._watch(stream);
        this._sync();
    }

    _watch(stream) {
        if (!(stream instanceof Gvc.MixerSinkInput) || this._streams.has(stream))
            return;
        this._streams.set(stream, stream.connect('notify::state', () => this._sync()));
        this._sync();
    }

    _unwatch(id) {
        for (const [stream, sig] of this._streams) {
            if (stream.get_id() === id) {
                stream.disconnect(sig);
                this._streams.delete(stream);
            }
        }
        this._sync();
    }

    // a stream that's someone else's sound, playing now
    static _audible(stream) {
        // (Gvc builds differ: a method in some, a plain property in others)
        const flag = name => typeof stream[name] === 'function' ? stream[name]() : Boolean(stream[name]);
        // (GNOME's Gvc often leaves a playback stream's state unknown: an open stream counts as
        // playing then; browsers close theirs a few seconds after you pause)
        const state = stream.get_state();
        if (flag('is_event_stream') || state === Gvc.MixerStreamState.IDLE || state === Gvc.MixerStreamState.SUSPENDED)
            return false;
        const who = `${stream.get_name() ?? ''} ${stream.get_application_id() ?? ''} ${stream.get_description?.() ?? ''}`;
        return !OWN.test(who);
    }

    // Another app playing: a media player saying so (MPRIS, PlaybackStatus Playing) AND a sound
    // stream of someone else's open on the sound server. Both, so neither a player that only
    // claims to play nor a stream left open by a paused app (or a filter) ever mutes the wallpaper.
    get rawPlaying() {
        if (!this._mpris.anyPlaying)
            return false;
        return [...this._streams.keys()].some(s => {
            try {
                return OtherMedia._audible(s);
            } catch {
                return false;                          // (a stream going away as it's read)
            }
        });
    }

    _sync() {
        if (!this._mpris)
            return;
        const now = this.rawPlaying;
        if (now) {
            if (this._quiet) {
                GLib.source_remove(this._quiet);
                this._quiet = 0;
            }
            this._set(true);
        } else if (this.playing && !this._quiet) {
            this._quiet = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE, () => {
                this._quiet = 0;
                this._set(this.rawPlaying);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _set(playing) {
        if (playing === this.playing)
            return;
        this.playing = playing;
        this.emit('changed');
    }

    destroy() {
        if (this._quiet)
            GLib.source_remove(this._quiet);
        this._mixerIds.forEach(id => this._mixer.disconnect(id));
        for (const [stream, sig] of this._streams)
            stream.disconnect(sig);
        this._streams.clear();
        this._mpris.destroy();
        this._mpris = null;
    }
}

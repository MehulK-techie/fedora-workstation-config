import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import { TouchpadPinchGesture } from './pinchTracker.js';
import { OSD_FRAMETIME_CAP_MS } from '../../constants.js';

const VolumeIcons = [
    'audio-volume-muted-symbolic',
    'audio-volume-low-symbolic',
    'audio-volume-medium-symbolic',
    'audio-volume-high-symbolic',
    'audio-volume-overamplified-symbolic',
];
export class PinchVolumeControlExtension {

    constructor(_nfingers) {
        this._nfingers = _nfingers;
        this._lastOsdShowTimestamp = 0;
        this._maxVolumeLimitRatio = 1.0;
    }

    apply() {
        this._controller = Volume.getMixerControl();
        this._maxVolume = this._controller.get_vol_max_norm();
        this._audioSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.sound',
        });
        this._sink = this._controller.get_default_sink();
        this._sinkChangeBinding = this._controller.connect('default-sink-changed', this._handleSinkChange.bind(this));
        this._pinchTracker = new TouchpadPinchGesture({
            nfingers: this._nfingers,
            allowedModes: Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        });
        this._connectHandlers = [
            this._pinchTracker.connect('begin', this._gestureBegin.bind(this)),
            this._pinchTracker.connect('update', this._gestureUpdate.bind(this)),
            this._pinchTracker.connect('end', this._gestureEnd.bind(this)),
        ];
    }

    destroy() {
        this._controller?.disconnect(this._sinkChangeBinding);
        delete this._controller;
        delete this._sink;

        // @ts-expect-error: audioSettings is a private property that needs cleanup
        delete this._audioSettings; // Cleanup settings object
        this._connectHandlers?.forEach(handle => this._pinchTracker?.disconnect(handle));
        this._connectHandlers = undefined;
        this._pinchTracker?.destroy();
    }

    _handleSinkChange(controller, id) {
        this._sink = controller.lookup_stream_id(id);
    }

    _showOsd(volume) {
        const nowTimestamp = Date.now();

        if (nowTimestamp - this._lastOsdShowTimestamp < OSD_FRAMETIME_CAP_MS) {
            return;
        }

        this._lastOsdShowTimestamp = nowTimestamp;
        const level = volume / this._maxVolume;
        let iconIndex;

        if (volume === 0) {
            iconIndex = 0;
        }
        else if (level > 1.0) {
            iconIndex = 4;
        }
        else {
            iconIndex = Math.clamp(Math.floor(3 * level + 1), 1, 3);
        }

        const icon = Gio.Icon.new_for_string(VolumeIcons[iconIndex]);
        const label = this._sink?.get_port().human_port ?? '';
        Main.osdWindowManager.showAll(icon, label, level, this._maxVolumeLimitRatio);
    }

    _gestureBegin() {
        if (this._sink === undefined ||
            this._controller === undefined ||
            this._pinchTracker === undefined) {
            return;
        }

        const isOverampEnabled = this._audioSettings.get_boolean('allow-volume-above-100-percent');
        this._maxVolumeLimitRatio = isOverampEnabled
            ? this._controller.get_vol_max_amplified() / this._maxVolume
            : 1.0;
        this._pinchTracker.confirmPinch(1, [0, this._maxVolumeLimitRatio], this._sink.volume / this._maxVolume);
    }

    _gestureUpdate(_tracker, progress) {
        if (this._sink === undefined) {
            return;
        }

        const volume = progress * this._maxVolume;

        if (volume > 0) {
            this._sink.change_is_muted(false);
        }

        this._sink.volume = volume;
        this._sink.push_volume();
        this._showOsd(volume);
    }

    _gestureEnd(_tracker, _duration, _endProgress) { }

}

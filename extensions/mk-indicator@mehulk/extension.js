import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MKIndicatorExtension extends Extension {
    enable() {
        this._indicator = new St.Button({
            style_class: 'panel-button',
            can_focus: false,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'padding: 0 5px; margin: 0 2px; background: transparent; border: none; box-shadow: none;'
        });

        // Translucent aesthetic monogram
        this._label = new St.Label({
            text: 'MK',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 700; font-size: 10px; letter-spacing: 2px; color: rgba(255, 255, 255, 0.25);'
        });

        this._indicator.set_child(this._label);

        this._indicator.connect('notify::hover', () => {
            if (this._indicator.hover) {
                this._label.set_style('font-weight: 700; font-size: 10px; letter-spacing: 2px; color: rgba(255, 255, 255, 0.85); transition-duration: 200ms;');
            } else {
                this._label.set_style('font-weight: 700; font-size: 10px; letter-spacing: 2px; color: rgba(255, 255, 255, 0.25); transition-duration: 250ms;');
            }
        });

        Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
            this._label = null;
        }
    }
}

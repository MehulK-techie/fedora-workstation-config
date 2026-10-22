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

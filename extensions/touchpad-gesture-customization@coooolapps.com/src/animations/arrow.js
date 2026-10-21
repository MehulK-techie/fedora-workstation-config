import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GObject from 'gi://GObject';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { easeActor } from '../utils/environment.js';
import { WIDGET_SHOWING_DURATION } from '../../constants.js';

const Circle = GObject.registerClass(class GIE_Circle extends St.Widget {

    constructor(style_class) {
        style_class = `gie-circle ${style_class}`;
        super({ style_class });
        this.set_pivot_point(0.5, 0.5);
    }

});
export const ArrowIconAnimation = GObject.registerClass(class GIE_ArrowIcon extends St.Widget {

    constructor(extensionPath) {
        super();
        this._connectors = [];
        this._extension_path = extensionPath;
        this._system_theme_setting = Gio.Settings.new('org.gnome.desktop.interface');
        this._connectors.push(this._system_theme_setting.connect('changed::color-scheme', () => this._updateStyle(this._system_theme_setting)));
        const color_scheme = this._system_theme_setting.get_string('color-scheme');
        this._inner_circle =
            color_scheme === 'prefer-light'
                ? new Circle('gie-inner-circle')
                : new Circle('gie-inner-circle-dark');
        this._outer_circle = new Circle('gie-outer-circle');
        this._arrow_icon = new St.Icon({ style_class: 'gie-arrow-icon' });
        this._inner_circle.set_clip_to_allocation(true);
        this._inner_circle.add_child(this._arrow_icon);
        this.add_child(this._outer_circle);
        this.add_child(this._inner_circle);
    }

    _updateStyle(system_theme_setting) {
        const color_scheme = system_theme_setting.get_string('color-scheme');

        if (color_scheme === 'prefer-light') {
            this._inner_circle.set_style_class_name('gie-circle gie-inner-circle');
        }
        else {
            this._inner_circle.set_style_class_name('gie-circle gie-inner-circle-dark');
        }
    }

    gestureBegin(icon_name, from_left) {
        this._transition = {
            arrow: {
                from: this._inner_circle.width * (from_left ? -1 : 1),
                end: 0,
            },
            outer_circle: {
                from: 1,
                end: 2,
            },
        };
        this._arrow_icon.translation_x = this._transition.arrow.from;
        this._outer_circle.scale_x = this._transition.outer_circle.from;
        this._outer_circle.scale_y = this._outer_circle.scale_x;
        this._arrow_icon.opacity = 255;

        // animating showing widget
        this.opacity = 0;
        this.show();
        easeActor(this, {
            opacity: 255,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration: WIDGET_SHOWING_DURATION,
        });
        this._arrow_icon.set_gicon(Gio.Icon.new_for_string(`${this._extension_path}/assets/${icon_name}`));
    }

    gestureUpdate(progress) {
        if (this._transition === undefined)
            return;
        this._arrow_icon.translation_x = Util.lerp(this._transition.arrow.from, this._transition.arrow.end, progress);
        this._outer_circle.scale_x = Util.lerp(this._transition.outer_circle.from, this._transition.outer_circle.end, progress);
        this._outer_circle.scale_y = this._outer_circle.scale_x;
    }

    gestureEnd(duration, progress, callback) {
        if (this._transition === undefined)
            return;
        easeActor(this, {
            opacity: 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration,
        });
        const translation_x = Util.lerp(this._transition.arrow.from, this._transition.arrow.end, progress);
        easeActor(this._arrow_icon, {
            translation_x,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_EXPO,
            onStopped: () => {
                callback();
                this.hide();
                this._arrow_icon.opacity = 0;
                this._arrow_icon.translation_x = 0;
                this._outer_circle.scale_x = 1;
                this._outer_circle.scale_y = 1;
            },
        });
        const scale = Util.lerp(this._transition.outer_circle.from, this._transition.outer_circle.end, progress);
        easeActor(this._outer_circle, {
            scale_x: scale,
            scale_y: scale,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_EXPO,
        });
    }

    destroy() {
        this._connectors.forEach(connector => this._system_theme_setting.disconnect(connector));
        this._connectors = [];
        this._extension_path = '';
        super.destroy();
    }

});

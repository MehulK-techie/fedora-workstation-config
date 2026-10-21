import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Config from '../config.js';
import Utils from '../utils/utils.js';
import AnimationUtils from '../utils/animationUtils.js';
export default class ProfilesMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor, arrowAlignment) {
        const shellBarPosition = Config.get_string('shell-bar-position');
        const openingSide = shellBarPosition === 'top' ? St.Side.TOP : St.Side.BOTTOM;
        super(sourceActor, arrowAlignment, openingSide);
        this.freed = false;
        this.profileSourceActor = sourceActor;
        this.actor.yExpand = true;
        Main.uiGroup.add_child(this.actor);
        this.createHeader();
        this.createProfiles();
        this.capturedEventId = global.stage.connect('captured-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                const [x, y] = event.get_coords();
                const [menuX, menuY] = this.actor.get_transformed_position();
                const [menuWidth, menuHeight] = this.actor.get_transformed_size();
                if (x < menuX || x > menuX + menuWidth || y < menuY || y > menuY + menuHeight) {
                    this.close(AnimationUtils.getMenuParams(true));
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.sourceActorDestroyId = sourceActor.connect('destroy', () => {
            this.sourceActorDestroyId = undefined;
            this.close(AnimationUtils.getMenuParams(false));
        });
    }
    createHeader() {
        const header = new PopupMenu.PopupMenuItem(_('Profiles'), {
            reactive: true,
            can_focus: false,
        });
        header.actor.xAlign = Clutter.ActorAlign.CENTER;
        header.sensitive = true;
        header.label.style = 'font-weight:bold;font-style:italic;';
        this.addMenuItem(header);
        header.connect('activate', () => {
            try {
                Config.set('queued-pref-category', 'profiles', 'string');
                Utils.extension?.openPreferences();
            }
            catch (e) {
            }
            this.close(AnimationUtils.getMenuParams(true));
        });
    }
    createProfiles() {
        const currentProfile = Config.get_string('current-profile');
        const profiles = Config.get_json('profiles');
        for (const profile in profiles) {
            const pre = profile === currentProfile ? '→ ' : '';
            const item = new PopupMenu.PopupMenuItem(pre + profile, {
                reactive: profile !== currentProfile,
                can_focus: false,
            });
            item.actor.xAlign = Clutter.ActorAlign.CENTER;
            (item.label.style = profile === currentProfile ? 'font-weight: bold;' : ''),
                (item.sensitive = profile !== currentProfile),
                this.addMenuItem(item);
            item.connect('activate', () => {
                Config.set('current-profile', profile, 'string');
                Utils.lowPriorityTask(Config.syncCurrentProfile);
                this.close(AnimationUtils.getMenuParams(true));
            });
        }
    }
    close(params) {
        if (!this.freed)
            super.close(params);
        this.destroy();
    }
    destroy() {
        if (this.capturedEventId) {
            global.stage.disconnect(this.capturedEventId);
            this.capturedEventId = undefined;
        }
        if (this.sourceActorDestroyId !== undefined && this.profileSourceActor) {
            this.profileSourceActor.disconnect(this.sourceActorDestroyId);
            this.sourceActorDestroyId = undefined;
        }
        this.profileSourceActor = undefined;
        if (this.freed)
            return;
        this.freed = true;
        this.removeAll();
        const parent = this.actor.get_parent();
        if (parent)
            parent.remove_child(this.actor);
        super.destroy();
    }
}

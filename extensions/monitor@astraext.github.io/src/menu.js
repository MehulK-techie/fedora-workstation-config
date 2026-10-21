/*!
 * Copyright (C) 2023 Lju
 *
 * This file is part of Astra Monitor extension for GNOME Shell.
 * [https://github.com/AstraExt/astra-monitor]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Mtk from 'gi://Mtk';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Signal from './signal.js';
import Utils from './utils/utils.js';
import AnimationUtils from './utils/animationUtils.js';
import ShellCompat from './utils/shellCompat.js';
import Grid from './grid.js';
import Config from './config.js';
const LOADING_ICON_STYLE = 'icon-size:1em;min-width:1.2em;margin-right:0.25em;';
class MenuBase extends PopupMenu.PopupMenu {
    constructor(sourceActor, arrowAlignment, params = {}) {
        super(sourceActor, arrowAlignment, params.arrowSide ?? MenuBase.openingSide);
        this.lastForcedUpdate = new Map();
        this.openUpdateTimers = new Map();
        this.openUpdateResponseHandlers = new Map();
        this.loadingIcons = new Set();
        this.lifecycleGeneration = 0;
        this.openLifecycleGeneration = 0;
        this.lifecycleActive = false;
        this.name = params.name ?? 'Unnamed Menu';
        Utils.verbose(`Creating ${this.name}`);
        if (params.scrollable) {
            const scrollView = new St.ScrollView({
                xExpand: true,
                yExpand: true,
                yAlign: Clutter.ActorAlign.START,
            });
            scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
            const boxLayout = new St.BoxLayout({
                ...ShellCompat.getBoxLayoutParams(true),
            });
            scrollView.add_child(boxLayout);
            this.statusMenu = new PopupMenu.PopupMenuSection();
            this.addMenuItem(this.statusMenu);
            const scrollActor = new St.Bin({ child: scrollView });
            this.statusMenu.actor.add_child(scrollActor);
            this.grid = new Grid({ numCols: params.numCols || 2 });
            boxLayout.add_child(this.grid);
            this.actor.add_style_class_name('panel-menu');
            Main.uiGroup.add_child(this.actor);
            this.actor.hide();
        }
        else {
            this.statusMenu = new PopupMenu.PopupMenuSection();
            this.grid = new Grid({ numCols: params.numCols || 2 });
            this.statusMenu.box.add_child(this.grid);
            this.addMenuItem(this.statusMenu);
            this.actor.add_style_class_name('panel-menu');
            Main.uiGroup.add_child(this.actor);
            this.actor.hide();
        }
    }
    static get arrowAlignement() {
        const shellBarPosition = Config.get_string('shell-bar-position');
        if (shellBarPosition === 'top')
            return St.Side.TOP;
        if (shellBarPosition === 'bottom')
            return St.Side.BOTTOM;
        if (shellBarPosition === 'left')
            return St.Side.LEFT;
        return St.Side.RIGHT;
    }
    static getMonitorSize(actorBox) {
        const display = global.display;
        const rect = new Mtk.Rectangle({
            x: actorBox.x1,
            y: actorBox.y1,
            width: actorBox.x2 - actorBox.x1,
            height: actorBox.y2 - actorBox.y1,
        });
        let monitorIndex = display.get_monitor_index_for_rect(rect);
        if (monitorIndex === -1)
            monitorIndex = display.get_primary_monitor();
        const geometry = display.get_monitor_geometry(monitorIndex);
        return { width: geometry.width, height: geometry.height };
    }
    addMenuSection(text, add = true, newLine = false) {
        const label = new St.Label({ text, styleClass: 'astra-monitor-menu-header-centered' });
        if (add) {
            if (newLine)
                this.grid.newLine();
            this.addToMenu(label, this.grid.getNumCols());
        }
        return label;
    }
    addMenuSeparator(text, add = true, newLine = false) {
        const separator = new PopupMenu.PopupSeparatorMenuItem(text);
        if (add) {
            if (newLine)
                this.grid.newLine();
            this.addToMenu(separator, this.grid.getNumCols());
        }
        return separator;
    }
    addToMenu(widget, colSpan = 1) {
        this.grid.addToGrid(widget, colSpan);
    }
    static createLoadingValue(label) {
        const box = new St.Widget({
            layoutManager: new Clutter.GridLayout({ orientation: Clutter.Orientation.HORIZONTAL }),
            xExpand: true,
            yAlign: Clutter.ActorAlign.CENTER,
        });
        const icon = new St.Icon({
            gicon: Utils.getLocalIcon('am-loading-symbolic'),
            fallbackIconName: 'dialog-information-symbolic',
            style: LOADING_ICON_STYLE,
            yAlign: Clutter.ActorAlign.CENTER,
        });
        icon.set_pivot_point(0.5, 0.5);
        icon.hide();
        box.add_child(icon);
        box.add_child(label);
        MenuBase.loadingLabels.set(label, {
            icon,
        });
        return box;
    }
    static setLoading(label, loading) {
        const loadingData = MenuBase.loadingLabels.get(label);
        if (!loadingData) {
            if (loading)
                label.text = '';
            return;
        }
        if (loading) {
            label.text = '';
            MenuBase.startLoadingIcon(loadingData.icon);
        }
        else {
            MenuBase.stopLoadingIcon(loadingData.icon);
        }
    }
    static startLoadingIcon(icon) {
        if (MenuBase.spinningLoadingIcons.has(icon))
            return;
        MenuBase.spinningLoadingIcons.add(icon);
        if (!MenuBase.loadingIconDestroySignals.has(icon)) {
            const destroyId = icon.connect('destroy', () => {
                MenuBase.removeLoadingIcon(icon, false);
                if (MenuBase.spinningLoadingIcons.size === 0)
                    MenuBase.stopLoadingSpinTimer();
            });
            MenuBase.loadingIconDestroySignals.set(icon, destroyId);
        }
        icon.remove_all_transitions?.();
        icon.set_pivot_point(0.5, 0.5);
        icon.rotation_angle_z = AnimationUtils.reducedMotion ? 0 : MenuBase.loadingSpinAngle;
        icon.show();
        if (!AnimationUtils.reducedMotion)
            MenuBase.startLoadingSpinTimer();
    }
    static stopLoadingIcon(icon) {
        MenuBase.removeLoadingIcon(icon, true);
        if (MenuBase.spinningLoadingIcons.size === 0)
            MenuBase.stopLoadingSpinTimer();
    }
    setLoading(label, loading) {
        const loadingData = MenuBase.loadingLabels.get(label);
        if (loading && !this.isOpen) {
            label.text = '';
            if (loadingData) {
                this.loadingIcons.delete(loadingData.icon);
                MenuBase.stopLoadingIcon(loadingData.icon);
            }
            return;
        }
        if (loadingData) {
            if (loading)
                this.loadingIcons.add(loadingData.icon);
            else
                this.loadingIcons.delete(loadingData.icon);
        }
        MenuBase.setLoading(label, loading);
    }
    startLoadingIcon(icon) {
        this.loadingIcons.add(icon);
        MenuBase.startLoadingIcon(icon);
    }
    stopLoadingIcon(icon) {
        this.loadingIcons.delete(icon);
        MenuBase.stopLoadingIcon(icon);
    }
    stopLoadingIndicators() {
        for (const icon of this.loadingIcons) {
            MenuBase.stopLoadingIcon(icon);
        }
        this.loadingIcons.clear();
    }
    static removeLoadingIcon(icon, reset) {
        MenuBase.spinningLoadingIcons.delete(icon);
        const destroyId = MenuBase.loadingIconDestroySignals.get(icon);
        if (destroyId !== undefined) {
            try {
                icon.disconnect(destroyId);
            }
            catch (e) {
            }
            MenuBase.loadingIconDestroySignals.delete(icon);
        }
        if (!reset)
            return;
        try {
            icon.remove_all_transitions?.();
            icon.rotation_angle_z = 0;
            icon.hide();
        }
        catch (e) {
        }
    }
    static startLoadingSpinTimer() {
        if (MenuBase.loadingSpinTimer !== 0 || AnimationUtils.reducedMotion)
            return;
        MenuBase.loadingSpinTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (MenuBase.spinningLoadingIcons.size === 0 || AnimationUtils.reducedMotion) {
                if (AnimationUtils.reducedMotion) {
                    for (const icon of MenuBase.spinningLoadingIcons) {
                        try {
                            icon.rotation_angle_z = 0;
                        }
                        catch (e) {
                            MenuBase.removeLoadingIcon(icon, false);
                        }
                    }
                }
                MenuBase.loadingSpinTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            MenuBase.loadingSpinAngle = (MenuBase.loadingSpinAngle + 18) % 360;
            for (const icon of MenuBase.spinningLoadingIcons) {
                try {
                    if (!icon.mapped)
                        continue;
                    icon.rotation_angle_z = MenuBase.loadingSpinAngle;
                }
                catch (e) {
                    MenuBase.removeLoadingIcon(icon, false);
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
    static stopLoadingSpinTimer() {
        if (MenuBase.loadingSpinTimer === 0)
            return;
        GLib.source_remove(MenuBase.loadingSpinTimer);
        MenuBase.loadingSpinTimer = 0;
    }
    get selectionStyle() {
        if (Utils.themeStyle === 'light')
            return 'background-color:rgba(0,0,0,0.1);box-shadow: 0 0 2px rgba(255,255,255,0.2);border-radius:0.3em;';
        return 'background-color:rgba(255,255,255,0.1);box-shadow: 0 0 2px rgba(0,0,0,0.2);border-radius:0.3em;';
    }
    addUtilityButtons(category, addButtons) {
        this.utilityBox = new St.BoxLayout({
            styleClass: 'astra-monitor-menu-button-box',
            xAlign: Clutter.ActorAlign.CENTER,
            reactive: true,
            xExpand: true,
        });
        if (addButtons)
            addButtons(this.utilityBox);
        const appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app('org.gnome.SystemMonitor.desktop');
        if (app) {
            this.systemMonitorButton = new St.Button({ styleClass: 'button' });
            this.systemMonitorButton.child = new St.Icon({
                gicon: Utils.getLocalIcon('am-system-monitor-symbolic'),
                fallbackIconName: 'org.gnome.SystemMonitor-symbolic',
            });
            Signal.connect(this.systemMonitorButton, 'clicked', () => {
                this.close(AnimationUtils.getMenuParams(true));
                app.activate();
            });
            this.utilityBox.add_child(this.systemMonitorButton);
        }
        else {
            app = appSys.lookup_app('gnome-system-monitor.desktop');
            if (app) {
                this.systemMonitorButton = new St.Button({ styleClass: 'button' });
                this.systemMonitorButton.child = new St.Icon({
                    gicon: Utils.getLocalIcon('am-system-monitor-symbolic'),
                    fallbackIconName: 'org.gnome.SystemMonitor-symbolic',
                });
                Signal.connect(this.systemMonitorButton, 'clicked', () => {
                    this.close(AnimationUtils.getMenuParams(true));
                    app.activate();
                });
                this.utilityBox.add_child(this.systemMonitorButton);
            }
        }
        this.preferencesButton = new St.Button({ styleClass: 'button' });
        this.preferencesButton.child = new St.Icon({
            gicon: Utils.getLocalIcon('am-settings-symbolic'),
            fallbackIconName: 'preferences-system-symbolic',
        });
        Signal.connect(this.preferencesButton, 'clicked', () => {
            this.close(AnimationUtils.getMenuParams(true));
            try {
                if (category)
                    Config.set('queued-pref-category', category, 'string');
                if (!Utils.extension)
                    throw new Error('Extension not found');
                Utils.extension.openPreferences();
            }
            catch (err) {
                Utils.log(`Error opening settings: ${err}`);
            }
        });
        this.utilityBox.add_child(this.preferencesButton);
        this.addToMenu(this.utilityBox, this.grid.getNumCols());
    }
    queueOpenLifecycle() {
        const generation = ++this.lifecycleGeneration;
        Utils.lowPriorityTask(() => {
            if (!this.isLifecycleCurrent(generation, true))
                return;
            this.runOpenLifecycle(generation);
        });
    }
    queueCloseLifecycle() {
        const generation = ++this.lifecycleGeneration;
        Utils.lowPriorityTask(() => {
            if (!this.isLifecycleCurrent(generation, false))
                return;
            this.runCloseLifecycle();
        });
    }
    isLifecycleCurrent(generation, open) {
        return this.lifecycleGeneration === generation && this.isOpen === open;
    }
    runOpenLifecycle(generation) {
        if (this.lifecycleActive) {
            if (this.openLifecycleGeneration === generation)
                return;
            this.runCloseLifecycle();
        }
        this.lifecycleActive = true;
        this.openLifecycleGeneration = generation;
        try {
            this.onOpen().catch(e => {
                Utils.error('Error opening menu', e instanceof Error ? e : new Error(String(e)));
            });
        }
        catch (e) {
            Utils.error('Error opening menu', e instanceof Error ? e : new Error(String(e)));
            this.runCloseLifecycle();
        }
    }
    runCloseLifecycle() {
        if (!this.lifecycleActive) {
            this.cancelOpenUpdates();
            this.stopLoadingIndicators();
            return;
        }
        this.lifecycleActive = false;
        this.openLifecycleGeneration = 0;
        try {
            this.onClose();
        }
        catch (e) {
            Utils.error('Error closing menu', e instanceof Error ? e : new Error(String(e)));
        }
    }
    async onOpen() { }
    onClose() {
        this.cancelOpenUpdates();
        this.stopLoadingIndicators();
    }
    canUseCachedValue(monitor, key, maxAgeMultiplier = 3) {
        return monitor.hasFreshValue(key, monitor.updateFrequencyMs * maxAgeMultiplier);
    }
    shouldRequestOpenUpdate(monitor, openDelayMs = 100) {
        const dueIn = monitor.dueIn;
        return dueIn < 0 || dueIn - openDelayMs > monitor.updateFrequencyMs / 2;
    }
    scheduleOpenUpdate(code, monitor, requestUpdate, openDelayMs = 100) {
        this.cancelOpenUpdate(code);
        if (!this.shouldRequestOpenUpdate(monitor, openDelayMs))
            return;
        const lifecycleGeneration = this.lifecycleGeneration;
        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, openDelayMs, () => {
            this.openUpdateTimers.delete(code);
            if (this.isLifecycleCurrent(lifecycleGeneration, true))
                requestUpdate();
            return GLib.SOURCE_REMOVE;
        });
        this.openUpdateTimers.set(code, timerId);
    }
    scheduleTwoSampleOpenUpdate(code, monitor, requestUpdate, openDelayMs = 100) {
        this.cancelOpenUpdate(code);
        const dueIn = monitor.dueIn;
        const followUp = dueIn < 0 || dueIn > 700;
        this.openUpdateResponseHandlers.set(code, {
            requestUpdate,
            requestStarted: false,
            waitingForFirstResponse: true,
            waitingForSecondResponse: false,
            followUp,
            lifecycleGeneration: this.lifecycleGeneration,
        });
        const lifecycleGeneration = this.lifecycleGeneration;
        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, openDelayMs, () => {
            this.openUpdateTimers.delete(code);
            if (this.isLifecycleCurrent(lifecycleGeneration, true)) {
                const handler = this.openUpdateResponseHandlers.get(code);
                if (handler)
                    handler.requestStarted = true;
                requestUpdate();
            }
            else {
                this.openUpdateResponseHandlers.delete(code);
            }
            return GLib.SOURCE_REMOVE;
        });
        this.openUpdateTimers.set(code, timerId);
    }
    bindOpenUpdate(code, callback) {
        return (...args) => {
            if (!this.handleOpenUpdateResponse(code))
                return;
            callback(...args);
        };
    }
    handleOpenUpdateResponse(code) {
        const handler = this.openUpdateResponseHandlers.get(code);
        if (!handler)
            return this.isOpen;
        if (!this.isLifecycleCurrent(handler.lifecycleGeneration, true)) {
            this.openUpdateResponseHandlers.delete(code);
            return false;
        }
        if (!handler.requestStarted)
            return true;
        if (handler.waitingForSecondResponse) {
            this.openUpdateResponseHandlers.delete(code);
            return true;
        }
        if (!handler.waitingForFirstResponse)
            return true;
        handler.waitingForFirstResponse = false;
        if (!handler.followUp) {
            handler.waitingForSecondResponse = true;
            return true;
        }
        const followUpCode = `${code}:follow-up`;
        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this.openUpdateTimers.delete(followUpCode);
            if (this.isLifecycleCurrent(handler.lifecycleGeneration, true)) {
                handler.waitingForSecondResponse = true;
                handler.requestUpdate();
            }
            else {
                this.openUpdateResponseHandlers.delete(code);
            }
            return GLib.SOURCE_REMOVE;
        });
        this.openUpdateTimers.set(followUpCode, timerId);
        return true;
    }
    isOpenUpdatePending(code) {
        return this.openUpdateResponseHandlers.has(code);
    }
    cancelOpenUpdate(code) {
        const timerId = this.openUpdateTimers.get(code);
        if (timerId !== undefined) {
            GLib.source_remove(timerId);
            this.openUpdateTimers.delete(code);
        }
        const followUpCode = `${code}:follow-up`;
        const followUpTimerId = this.openUpdateTimers.get(followUpCode);
        if (followUpTimerId !== undefined) {
            GLib.source_remove(followUpTimerId);
            this.openUpdateTimers.delete(followUpCode);
        }
        this.openUpdateResponseHandlers.delete(code);
    }
    cancelOpenUpdates() {
        for (const timerId of this.openUpdateTimers.values()) {
            GLib.source_remove(timerId);
        }
        this.openUpdateTimers.clear();
        this.openUpdateResponseHandlers.clear();
    }
    updateFreshOrShowLoading(monitor, key, code, showLoading) {
        if (this.canUseCachedValue(monitor, key)) {
            this.update(code, true);
            return true;
        }
        showLoading();
        return false;
    }
    needsUpdate(code, forced = false) {
        if (forced) {
            const lastUpdate = this.lastForcedUpdate.get(code);
            if (lastUpdate && Date.now() - lastUpdate < 1000) {
                return false;
            }
            this.lastForcedUpdate.set(code, Date.now());
        }
        return true;
    }
    update(_code, _forced = false) {
        Utils.error('update() needs to be overridden');
    }
    destroy() {
        this.close(AnimationUtils.getMenuParams(false));
        Config.clear(this);
        Signal.clear(this);
        Signal.clear(this.systemMonitorButton);
        Signal.clear(this.preferencesButton);
        this.onClose();
        this.systemMonitorButton?.destroy();
        this.systemMonitorButton = undefined;
        this.preferencesButton?.destroy();
        this.preferencesButton = undefined;
        this.grid?.destroy();
        this.grid = undefined;
        this.statusMenu?.destroy();
        this.statusMenu = undefined;
        this.removeAll();
        Main.uiGroup.remove_child(this.actor);
        super.destroy();
    }
}
MenuBase.openingSide = St.Side.RIGHT;
MenuBase.spinningLoadingIcons = new Set();
MenuBase.loadingIconDestroySignals = new Map();
MenuBase.loadingSpinTimer = 0;
MenuBase.loadingSpinAngle = 0;
MenuBase.loadingLabels = new WeakMap();
export default MenuBase;

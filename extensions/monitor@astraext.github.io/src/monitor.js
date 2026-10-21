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
import GLib from 'gi://GLib';
import Utils from './utils/utils.js';
export default class Monitor {
    constructor(name) {
        this.timerID = null;
        this.listeners = new Map();
        this.usageHistory = new Map();
        this.usageHistoryTime = new Map();
        this.enqueuedUpdates = [];
        this.nextCallTime = -1;
        this.usageHistoryLength = 200;
        this.name = name;
    }
    get updateFrequency() {
        Utils.log('UPDATE FREQUENCY MUST BE OVERWRITTEN');
        return -1;
    }
    get dueIn() {
        if (this.nextCallTime === -1)
            return -1;
        const dueInMicroseconds = this.nextCallTime - GLib.get_monotonic_time();
        return dueInMicroseconds / 1000;
    }
    get updateFrequencyMs() {
        return this.updateFrequency * 1000;
    }
    get historyLength() {
        return this.usageHistoryLength;
    }
    start() {
        Utils.log(`Starting ${this.name} monitoring`);
        const updateFrequency = this.updateFrequency;
        if (this.timerID === null) {
            if (updateFrequency >= 0.1) {
                this.nextCallTime = GLib.get_monotonic_time() + updateFrequency * 1000000;
                this.timerID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, updateFrequency * 1000, () => {
                    const res = this.update();
                    this.nextCallTime = GLib.get_monotonic_time() + updateFrequency * 1000000;
                    return res;
                });
            }
        }
    }
    stop() {
        Utils.log(`Stopping ${this.name} monitoring`);
        if (this.timerID) {
            GLib.source_remove(this.timerID);
            this.timerID = null;
            this.nextCallTime = -1;
        }
        this.resetData();
    }
    resetData() {
        this.usageHistory = new Map();
        this.usageHistoryTime = new Map();
        this.enqueuedUpdates = [];
    }
    restart() {
        this.stop();
        this.start();
    }
    startListeningFor(_key) { }
    stopListeningFor(_key) { }
    update() {
        Utils.log('UPDATE MUST BE OVERWRITTEN');
        return true;
    }
    runTask({ key, task, run, callback }) {
        task.run(run)
            .then(callback)
            .catch(e => {
            if (e.isCancelled) {
                Utils.log(this.name + ' update canceled: ' + key);
            }
            else {
                Utils.error(`Error running '${this.name}' task - ${key}`, e);
            }
        });
    }
    pushUsageHistory(key, value) {
        let values = this.usageHistory.get(key);
        if (values === undefined) {
            values = [];
            this.usageHistory.set(key, values);
        }
        let times = this.usageHistoryTime.get(key);
        if (times === undefined) {
            times = [];
            this.usageHistoryTime.set(key, times);
        }
        if (this.enqueuedUpdates.includes(key) && values.length > 0) {
            values[0] = value;
            times[0] = Date.now();
            this.enqueuedUpdates = this.enqueuedUpdates.filter(k => k !== key);
        }
        else {
            values.unshift(value);
            times.unshift(Date.now());
            if (values.length > this.usageHistoryLength) {
                values.pop();
                times.pop();
            }
        }
    }
    setUsageValue(key, value) {
        this.usageHistory.set(key, [value]);
        this.usageHistoryTime.set(key, [Date.now()]);
    }
    getUsageHistory(key) {
        const values = this.usageHistory.get(key);
        if (values === undefined)
            return [];
        return values;
    }
    getUsageHistoryTimes(key) {
        const times = this.usageHistoryTime.get(key);
        if (times === undefined)
            return [];
        return times;
    }
    getCurrentValue(key) {
        const values = this.usageHistory.get(key);
        if (values === undefined)
            return null;
        return values[0];
    }
    getCurrentValueTime(key) {
        const times = this.usageHistoryTime.get(key);
        if (times === undefined)
            return 0;
        return times[0];
    }
    getValueAgeMs(key) {
        const valueTime = this.getCurrentValueTime(key);
        if (!valueTime)
            return null;
        return Date.now() - valueTime;
    }
    hasFreshValue(key, maxAgeMs) {
        const value = this.getCurrentValue(key);
        if (value === null || value === undefined)
            return false;
        const valueAge = this.getValueAgeMs(key);
        return valueAge !== null && valueAge <= maxAgeMs;
    }
    isDueWithin(ms) {
        const dueIn = this.dueIn;
        return dueIn >= 0 && dueIn <= ms;
    }
    resetUsageHistory(key) {
        this.usageHistory.set(key, []);
        this.usageHistoryTime.set(key, []);
    }
    requestUpdate(key) {
        if (!this.enqueuedUpdates.includes(key)) {
            this.enqueuedUpdates.push(key);
        }
    }
    isListeningFor(key) {
        const listeners = this.listeners.get(key);
        if (!listeners)
            return false;
        return listeners.length > 0;
    }
    listen(subject, key, callback) {
        let listeners = this.listeners.get(key);
        if (listeners === undefined) {
            listeners = [];
            this.listeners.set(key, listeners);
        }
        for (const listener of listeners) {
            if (listener.subject === subject) {
                listener.callback = callback;
                return;
            }
        }
        listeners.push({ callback, subject });
        this.startListeningFor(key);
    }
    notify(key, value) {
        if (!Utils.ready)
            return;
        const registered = this.listeners.get(key);
        if (!registered || registered.length === 0)
            return;
        for (const listener of [...registered]) {
            if (!Utils.ready)
                return;
            const currentListeners = this.listeners.get(key);
            if (!currentListeners?.includes(listener))
                continue;
            try {
                listener.callback(value);
            }
            catch (e) {
                Utils.error(`Error notifying listener for ${key}`, e);
                const msg = e?.message ?? '';
                if (typeof msg === 'string' && msg.includes('has been already disposed')) {
                    this.unlisten(listener.subject, key);
                }
            }
        }
    }
    unlisten(subject, key) {
        if (key === undefined) {
            for (const [listenerKey, listeners] of this.listeners) {
                const newListeners = listeners.filter(listener => listener.subject !== subject);
                this.listeners.set(listenerKey, newListeners);
                if (newListeners.length === 0) {
                    this.stopListeningFor(listenerKey);
                }
            }
            return;
        }
        const listeners = this.listeners.get(key);
        if (listeners) {
            const newListeners = listeners.filter(listener => listener.subject !== subject);
            this.listeners.set(key, newListeners);
            if (newListeners.length === 0) {
                this.stopListeningFor(key);
            }
        }
    }
    destroy() {
        this.stop();
        this.listeners = new Map();
    }
}

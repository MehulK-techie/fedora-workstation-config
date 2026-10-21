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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
class CancellableTask {
    constructor(boundTask) {
        this.boundTask = boundTask;
        this.taskPromise = new Promise((resolve, reject) => {
            this.rejectFn = reject;
            this.timeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try {
                    this.boundTask()
                        .then(resolve)
                        .catch(reject)
                        .finally(() => {
                        this.rejectFn = undefined;
                    });
                }
                catch (e) {
                    reject(e);
                    this.rejectFn = undefined;
                }
                this.timeoutId = undefined;
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    get promise() {
        return this.taskPromise;
    }
    cancel() {
        if (this.timeoutId) {
            GLib.source_remove(this.timeoutId);
            this.timeoutId = undefined;
        }
        if (this.rejectFn) {
            this.rejectFn({ isCancelled: true, message: 'Task cancelled' });
        }
        this.rejectFn = undefined;
    }
}
export default class CancellableTaskManager {
    get cancellable() {
        if (!this.taskCancellable) {
            this.taskCancellable = new Gio.Cancellable();
        }
        return this.taskCancellable;
    }
    run(boundTask) {
        this.cancel();
        this.taskCancellable = new Gio.Cancellable();
        const task = new CancellableTask(boundTask);
        this.currentTask = task;
        return task.promise.finally(() => {
            if (this.currentTask === task) {
                this.cancel();
            }
        });
    }
    setSubprocess(subprocess) {
        if (this.cancelId !== undefined) {
            this.taskCancellable?.disconnect(this.cancelId);
            this.cancelId = undefined;
        }
        const cancellable = this.taskCancellable;
        if (!cancellable || cancellable.is_cancelled()) {
            try {
                subprocess.force_exit();
            }
            catch (_) {
            }
            return;
        }
        this.cancelId = cancellable.connect(() => {
            try {
                subprocess.force_exit();
            }
            catch (_) {
            }
        });
    }
    cancel() {
        if (this.currentTask) {
            this.currentTask.cancel();
            this.currentTask = undefined;
        }
        if (this.taskCancellable) {
            try {
                this.taskCancellable.cancel();
            }
            catch (_) {
            }
            if (this.cancelId !== undefined) {
                this.taskCancellable.disconnect(this.cancelId);
                this.cancelId = undefined;
            }
        }
        this.taskCancellable = undefined;
    }
    get isRunning() {
        return !!this.currentTask;
    }
}

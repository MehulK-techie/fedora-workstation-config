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
export default class TopProcessesCache {
    constructor(updateTime) {
        this.processesCache = new Map();
        this.updateTime = updateTime;
    }
    updateNotSeen(pidList) {
        for (const [pid, process] of this.processesCache) {
            if (!pidList.includes(pid)) {
                process.notSeen++;
                if (process.notSeen > 300 / this.updateTime)
                    this.processesCache.delete(pid);
            }
            else {
                process.notSeen = 0;
            }
        }
    }
    getProcess(pid) {
        return this.processesCache.get(pid);
    }
    setProcess(process) {
        this.processesCache.set(process.pid, process);
    }
    reset() {
        this.processesCache.clear();
    }
}

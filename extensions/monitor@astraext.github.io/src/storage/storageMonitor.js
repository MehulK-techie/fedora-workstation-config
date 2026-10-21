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
import Config from '../config.js';
import Utils from '../utils/utils.js';
import Monitor from '../monitor.js';
import CancellableTaskManager from '../utils/cancellableTaskManager.js';
import PromiseValueHolder, { PromiseValueHolderStore } from '../utils/promiseValueHolder.js';
import TopProcessesCache from '../utils/topProcessesCache.js';
import ContinuousTaskManager from '../utils/continuousTaskManager.js';
export default class StorageMonitor extends Monitor {
    static get TOP_PROCESSES_LIMIT() {
        return 10;
    }
    constructor() {
        super('Storage Monitor');
        this.storageIOTopStarting = false;
        this.disksCache = new Map();
        this.topProcessesCache = new TopProcessesCache(this.updateFrequency);
        this.diskChecks = {};
        this.sectorSizes = {};
        this.updateMountpointCache = new CancellableTaskManager();
        this.updateStorageUsageTask = new CancellableTaskManager();
        this.updateTopProcessesTask = new CancellableTaskManager();
        this.updateStorageIOTask = new CancellableTaskManager();
        this.updateStorageInfoTask = new CancellableTaskManager();
        this.updateStorageIOTopTask = new ContinuousTaskManager();
        this.updateStorageIOTopTask.listen(this, this.updateStorageIOTop.bind(this));
        this.checkMainDiskAsync().catch(e => {
            Utils.error('Error checking main disk', e);
        });
        this.reset();
        this.dataSourcesInit();
        const enabled = Config.get_boolean('storage-header-show');
        if (enabled)
            this.start();
        Config.connect(this, 'changed::storage-header-show', () => {
            if (Config.get_boolean('storage-header-show'))
                this.start();
            else
                this.stop();
        });
        Config.connect(this, 'changed::storage-update', this.restart.bind(this));
        this.ignored = Config.get_json('storage-ignored');
        if (this.ignored === null || !Array.isArray(this.ignored))
            this.ignored = [];
        Config.connect(this, 'changed::storage-ignored', () => {
            this.reset();
            this.ignored = Config.get_json('storage-ignored');
            if (this.ignored === null || !Array.isArray(this.ignored))
                this.ignored = [];
        });
        {
            const regex = Config.get_string('storage-ignored-regex');
            try {
                if (regex === null || regex === '')
                    this.ignoredRegex = null;
                else
                    this.ignoredRegex = new RegExp(`^${regex}$`, 'i');
            }
            catch (e) {
                this.ignoredRegex = null;
            }
        }
        Config.connect(this, 'changed::storage-ignored-regex', () => {
            this.reset();
            const regex = Config.get_string('storage-ignored-regex');
            try {
                if (regex === null || regex === '')
                    this.ignoredRegex = null;
                else
                    this.ignoredRegex = new RegExp(`^${regex}$`, 'i');
            }
            catch (e) {
                this.ignoredRegex = null;
            }
        });
    }
    get showConfig() {
        return 'storage-header-show';
    }
    get updateFrequency() {
        return Config.get_double('storage-update');
    }
    reset() {
        this.previousStorageIO = {
            bytesRead: -1,
            bytesWritten: -1,
            time: -1,
        };
        this.previousDetailedStorageIO = {
            devices: null,
            time: -1,
        };
        this.topProcessesCache?.reset();
        this.previousPidsIO = new Map();
        this.updateMountpointCache?.cancel();
        this.updateStorageUsageTask?.cancel();
        this.updateTopProcessesTask?.cancel();
        this.updateStorageIOTask?.cancel();
        this.updateStorageInfoTask?.cancel();
        this.disksCache?.clear();
    }
    async checkMainDiskAsync(disks) {
        let storageMain = Config.get_string('storage-main');
        const diskList = disks ?? (await Utils.listDisksAsync());
        if (!storageMain || storageMain === '[default]' || !diskList.has(storageMain)) {
            const defaultId = Utils.findDefaultDisk(diskList);
            if (defaultId !== null) {
                const currentStorageMain = Config.get_string('storage-main');
                if (!currentStorageMain ||
                    currentStorageMain === '[default]' ||
                    !diskList.has(currentStorageMain)) {
                    Config.set('storage-main', defaultId, 'string');
                }
                storageMain = defaultId;
            }
        }
        return storageMain;
    }
    start() {
        super.start();
    }
    stop() {
        super.stop();
        this.stopIOTop();
        this.reset();
    }
    async startIOTop() {
        if ((this.updateStorageIOTopTask?.isRunning ?? false) || this.storageIOTopStarting) {
            return;
        }
        this.storageIOTopStarting = true;
        try {
            const pkexecPath = await Utils.getPkexecPathAsync();
            if (pkexecPath === false) {
                Utils.error('pkexec not found');
                return;
            }
            const iotopPath = await Utils.getIotopPathAsync();
            if (iotopPath === false) {
                Utils.error('iotop not found');
                return;
            }
            if (this.updateStorageIOTopTask?.isRunning ?? false)
                return;
            const interval = Math.max(1, Math.min(Math.round(this.updateFrequency), 15));
            const num = Math.max(1, Math.round(60 / interval));
            const command = `${pkexecPath}pkexec ${iotopPath}iotop -bPokq -d ${interval} -n ${num}`;
            this.updateStorageIOTopTask.start(command, {
                flush: { idle: 100 },
            });
        }
        finally {
            this.storageIOTopStarting = false;
        }
    }
    stopIOTop() {
        this.storageIOTopStarting = false;
        if (this.updateStorageIOTopTask?.isRunning) {
            this.updateStorageIOTopTask.stop();
        }
    }
    dataSourcesInit() {
        this.dataSources = {
            storageUsage: Config.get_string('storage-source-storage-usage') ?? undefined,
            topProcesses: Config.get_string('storage-source-top-processes') ?? undefined,
            storageIO: Config.get_string('storage-source-storage-io') ?? undefined,
        };
        Config.connect(this, 'changed::storage-source-storage-usage', () => {
            this.dataSources.storageUsage =
                Config.get_string('storage-source-storage-usage') ?? undefined;
            this.disksCache.clear();
            this.resetUsageHistory('storageUsage');
        });
        Config.connect(this, 'changed::storage-source-top-processes', () => {
            this.dataSources.topProcesses =
                Config.get_string('storage-source-top-processes') ?? undefined;
            this.topProcessesCache.reset();
            this.previousPidsIO = new Map();
            this.resetUsageHistory('topProcesses');
        });
        Config.connect(this, 'changed::storage-source-storage-io', () => {
            this.dataSources.storageIO =
                Config.get_string('storage-source-storage-io') ?? undefined;
            this.disksCache.clear();
            this.previousStorageIO = {
                bytesRead: -1,
                bytesWritten: -1,
                time: -1,
            };
            this.previousDetailedStorageIO = {
                devices: null,
                time: -1,
            };
            this.resetUsageHistory('storageIO');
            this.resetUsageHistory('detailedStorageIO');
        });
    }
    stopListeningFor(key) {
        super.stopListeningFor(key);
        if (key === 'topProcesses') {
            this.previousPidsIO = new Map();
        }
        if (key === 'storageIO') {
            this.previousStorageIO = {
                bytesRead: -1,
                bytesWritten: -1,
                time: -1,
            };
        }
        if (key === 'detailedStorageIO') {
            this.previousDetailedStorageIO.devices = null;
            this.previousDetailedStorageIO.time = -1;
        }
    }
    update() {
        Utils.verbose('Updating Storage Monitor');
        const enabled = Config.get_boolean('storage-header-show');
        if (enabled) {
            this.runUpdate('storageUsage');
            if (Utils.GTop) {
                if (this.isListeningFor('topProcesses'))
                    this.runUpdate('topProcesses');
                else
                    this.topProcessesCache.updateNotSeen([]);
            }
            const detailed = this.isListeningFor('detailedStorageIO');
            const procDiskstats = new PromiseValueHolderStore(this.getProcDiskStatsAsync.bind(this));
            this.runUpdate('updateStorageIO', detailed, procDiskstats);
        }
        return true;
    }
    requestUpdate(key) {
        if (key === 'storageUsage') {
            this.runUpdate('storageUsage');
        }
        else if (key === 'storageIO' || key === 'detailedStorageIO') {
            const procDiskstats = new PromiseValueHolderStore(this.getProcDiskStatsAsync.bind(this));
            const detailed = key === 'detailedStorageIO';
            this.runUpdate('updateStorageIO', detailed, procDiskstats);
            if (detailed)
                super.requestUpdate('storageIO');
        }
        else if (key === 'topProcesses') {
            if (!this.updateTopProcessesTask.isRunning && Utils.GTop)
                this.runUpdate('topProcesses');
            return;
        }
        else if (key === 'storageInfo') {
            if (!this.updateStorageInfoTask.isRunning)
                this.runUpdate('storageInfo');
            return;
        }
        super.requestUpdate(key);
    }
    runUpdate(key, ...params) {
        if (key === 'storageUsage') {
            let run;
            if (this.dataSources.storageUsage === 'GTop')
                run = this.updateStorageUsageGTop.bind(this, ...params);
            else if (this.dataSources.storageUsage === 'proc')
                run = this.updateStorageUsageProc.bind(this, ...params);
            else
                run = this.updateStorageUsageAuto.bind(this, ...params);
            this.runTask({
                key,
                task: this.updateStorageUsageTask,
                run,
                callback: this.notify.bind(this, 'storageUsage'),
            });
            return;
        }
        if (key === 'topProcesses') {
            let run;
            if (this.dataSources.topProcesses === 'GTop')
                run = this.updateTopProcessesGTop.bind(this, ...params);
            else
                run = this.updateTopProcessesAuto.bind(this, ...params);
            this.runTask({
                key,
                task: this.updateTopProcessesTask,
                run,
                callback: this.notify.bind(this, 'topProcesses'),
            });
            return;
        }
        if (key === 'updateStorageIO') {
            const detailed = params[0];
            const callback = () => {
                this.notify('storageIO');
                if (detailed)
                    this.notify('detailedStorageIO');
            };
            let run;
            if (this.dataSources.storageIO === 'GTop' && false)
                run = this.updateStorageIOGTop.bind(this, ...params);
            else if (this.dataSources.storageIO === 'proc')
                run = this.updateStorageIOProc.bind(this, ...params);
            else
                run = this.updateStorageIOAuto.bind(this, ...params);
            this.runTask({
                key,
                task: this.updateStorageIOTask,
                run,
                callback,
            });
            return;
        }
        if (key === 'storageInfo') {
            this.runTask({
                key,
                task: this.updateStorageInfoTask,
                run: this.updateStorageInfo.bind(this, ...params),
                callback: this.notify.bind(this, 'storageInfo'),
            });
            return;
        }
    }
    getProcDiskStatsAsync() {
        return new PromiseValueHolder(new Promise((resolve, reject) => {
            Utils.readFileAsync('/proc/diskstats')
                .then(fileContent => {
                resolve(fileContent.split('\n'));
            })
                .catch(e => {
                reject(e);
            });
        }));
    }
    updateStorageUsageAuto() {
        if (Utils.GTop)
            return this.updateStorageUsageGTop();
        return this.updateStorageUsageProc();
    }
    async updateStorageUsageProc() {
        let mainDisk = Config.get_string('storage-main');
        const disks = await Utils.listDisksAsync(this.updateStorageUsageTask);
        try {
            if (!mainDisk || mainDisk === '[default]')
                mainDisk = await this.checkMainDiskAsync(disks);
            let disk = disks.get(mainDisk || '');
            if (!disk) {
                mainDisk = await this.checkMainDiskAsync(disks);
                disk = disks.get(mainDisk || '');
            }
            if (!disk || !disk.path)
                return false;
            const path = disk.path.replace(/[^a-zA-Z0-9/-]/g, '');
            const lsblkPath = await Utils.getLsblkPathAsync();
            if (lsblkPath === false)
                return false;
            const result = await Utils.runAsyncCommand(`${lsblkPath}lsblk -Jb -o ID,SIZE,FSUSE% ${path}`, this.updateStorageUsageTask);
            if (result) {
                const json = JSON.parse(result);
                if (json.blockdevices && json.blockdevices.length > 0) {
                    const usage = parseInt(json.blockdevices[0]['fsuse%'], 10);
                    const size = json.blockdevices[0]['size'];
                    this.pushUsageHistory('storageUsage', {
                        size: size,
                        used: Math.round((size * usage) / 100),
                        free: Math.round((size * (100 - usage)) / 100),
                        usePercentage: usage,
                    });
                    return true;
                }
            }
        }
        catch (e) {
            Utils.error('Error updating storage usage', e);
        }
        return false;
    }
    async updateStorageUsageGTop() {
        const GTop = Utils.GTop;
        if (!GTop)
            return false;
        let mainDisk = Config.get_string('storage-main');
        try {
            if (!mainDisk || mainDisk === '[default]')
                mainDisk = await this.checkMainDiskAsync();
            if (!mainDisk)
                return false;
            const disk = await this.getCachedDisk(mainDisk);
            const mountpoints = disk?.mountpoints;
            if (!mountpoints ||
                mountpoints.length === 0 ||
                (mountpoints.length === 1 && mountpoints[0] === '[SWAP]'))
                return false;
            const buf = new GTop.glibtop_fsusage();
            let mnt = 0;
            while (buf.blocks === 0 && mnt <= mountpoints.length)
                GTop.glibtop_get_fsusage(buf, mountpoints[mnt++]);
            if (buf.blocks === 0)
                return false;
            const size = buf.blocks * buf.block_size;
            const free = buf.bfree * buf.block_size;
            this.pushUsageHistory('storageUsage', {
                size: size,
                used: size - free,
                free: free,
                usePercentage: Math.round(((size - free) / size) * 100),
            });
            return true;
        }
        catch (e) {
        }
        return false;
    }
    async getSectorSizeAsync(device) {
        if (this.sectorSizes[device] === undefined) {
            const fileContents = await Utils.readFileAsync(`/sys/block/${device}/queue/hw_sector_size`, true);
            const sectorSize = parseInt(fileContents, 10);
            this.sectorSizes[device] = isNaN(sectorSize) ? 512 : sectorSize;
        }
        return this.sectorSizes[device];
    }
    isDisk(deviceName) {
        if (this.diskChecks[deviceName] !== undefined)
            return this.diskChecks[deviceName];
        try {
            const path = `/sys/block/${deviceName}`;
            const fileType = GLib.file_test(path, GLib.FileTest.IS_DIR);
            this.diskChecks[deviceName] = fileType;
            return fileType;
        }
        catch (e) {
            return false;
        }
    }
    updateStorageIOAuto(detailed, procDiskstats) {
        if (Utils.GTop && false)
            return this.updateStorageIOGTop(detailed);
        return this.updateStorageIOProc(detailed, procDiskstats);
    }
    async updateStorageIOProc(detailed, procDiskstats) {
        const procDiskstatsValue = await procDiskstats.getValue();
        if (procDiskstatsValue.length < 1)
            return false;
        let bytesRead = 0;
        let bytesWritten = 0;
        let devices = null;
        if (detailed)
            devices = new Map();
        let lastSectorSize = -1;
        const sectorSizePromises = [];
        for (const device of procDiskstatsValue) {
            const fields = device.trim().split(/\s+/);
            if (fields.length < 10)
                continue;
            const deviceName = fields[2];
            if (deviceName.startsWith('loop'))
                continue;
            if (this.ignored.includes(deviceName))
                continue;
            if (this.ignoredRegex !== null && this.ignoredRegex.test(deviceName))
                continue;
            const isPartition = !this.isDisk(deviceName);
            if (!isPartition && this.sectorSizes[deviceName] === undefined)
                sectorSizePromises.push(this.getSectorSizeAsync(deviceName));
        }
        await Promise.all(sectorSizePromises);
        for (const device of procDiskstatsValue) {
            const fields = device.trim().split(/\s+/);
            if (fields.length < 10)
                continue;
            const deviceName = fields[2];
            if (deviceName.startsWith('loop'))
                continue;
            if (this.ignored.includes(deviceName))
                continue;
            if (this.ignoredRegex !== null && this.ignoredRegex.test(deviceName))
                continue;
            const isPartition = !this.isDisk(deviceName);
            const readSectors = parseInt(fields[5]);
            const writtenSectors = parseInt(fields[9]);
            if (!isPartition)
                lastSectorSize = this.sectorSizes[deviceName] ?? 512;
            if (detailed && devices !== null) {
                devices.set(deviceName, {
                    bytesRead: readSectors * lastSectorSize,
                    bytesWritten: writtenSectors * lastSectorSize,
                });
            }
            if (!isPartition) {
                bytesRead += readSectors * lastSectorSize;
                bytesWritten += writtenSectors * lastSectorSize;
            }
        }
        const now = GLib.get_monotonic_time();
        if (detailed) {
            if (this.previousDetailedStorageIO.devices === null ||
                this.previousDetailedStorageIO.time === -1) {
                this.previousDetailedStorageIO.devices = devices;
                this.previousDetailedStorageIO.time = now;
            }
        }
        if (this.previousStorageIO.bytesRead === -1 ||
            this.previousStorageIO.bytesWritten === -1 ||
            this.previousStorageIO.time === -1) {
            this.previousStorageIO.bytesRead = bytesRead;
            this.previousStorageIO.bytesWritten = bytesWritten;
            this.previousStorageIO.time = now;
            return false;
        }
        {
            const interval = (now - this.previousStorageIO.time) / 1000000;
            const bytesReadPerSec = Math.round((bytesRead - this.previousStorageIO.bytesRead) / interval);
            const bytesWrittenPerSec = Math.round((bytesWritten - this.previousStorageIO.bytesWritten) / interval);
            const totalBytesRead = bytesRead;
            const totalBytesWritten = bytesWritten;
            this.previousStorageIO.bytesRead = bytesRead;
            this.previousStorageIO.bytesWritten = bytesWritten;
            this.previousStorageIO.time = now;
            this.pushUsageHistory('storageIO', {
                bytesReadPerSec,
                bytesWrittenPerSec,
                totalBytesRead,
                totalBytesWritten,
            });
        }
        if (detailed && devices !== null) {
            if (this.previousDetailedStorageIO.time === now)
                return false;
            if (this.previousDetailedStorageIO.devices === null)
                return false;
            const finalData = new Map();
            const interval = (now - this.previousDetailedStorageIO.time) / 1000000;
            for (const [deviceName, { bytesRead: deviceBytesRead, bytesWritten: deviceBytesWritten },] of devices) {
                const previousData = this.previousDetailedStorageIO.devices.get(deviceName);
                if (previousData) {
                    const bytesReadPerSec = Math.round((deviceBytesRead - previousData.bytesRead) / interval);
                    const bytesWrittenPerSec = Math.round((deviceBytesWritten - previousData.bytesWritten) / interval);
                    const totalBytesRead = deviceBytesRead;
                    const totalBytesWritten = deviceBytesWritten;
                    finalData.set(deviceName, {
                        bytesReadPerSec,
                        bytesWrittenPerSec,
                        totalBytesRead,
                        totalBytesWritten,
                    });
                }
            }
            this.previousDetailedStorageIO.devices = devices;
            this.previousDetailedStorageIO.time = now;
            this.pushUsageHistory('detailedStorageIO', finalData);
        }
        return true;
    }
    async updateStorageIOGTop(detailed) {
        const GTop = Utils.GTop;
        if (!GTop)
            return false;
        if (detailed) {
        }
        return false;
    }
    updateTopProcessesAuto() {
        if (Utils.GTop)
            return this.updateTopProcessesGTop();
        return Promise.resolve(false);
    }
    async updateTopProcessesGTop() {
        const GTop = Utils.GTop;
        if (!GTop)
            return false;
        const buf = new GTop.glibtop_proclist();
        const pids = GTop.glibtop_get_proclist(buf, GTop.GLIBTOP_KERN_PROC_ALL, 0);
        pids.length = buf.number;
        const topProcesses = [];
        const seenPids = [];
        const io = new GTop.glibtop_proc_io();
        let procState = null;
        let argSize = null;
        for (const pid of pids) {
            seenPids.push(pid);
            let process = this.topProcessesCache.getProcess(pid);
            if (!process) {
                if (!argSize)
                    argSize = new GTop.glibtop_proc_args();
                let cmd = GTop.glibtop_get_proc_args(argSize, pid, 0);
                if (!cmd) {
                    if (!procState)
                        procState = new GTop.glibtop_proc_state();
                    GTop.glibtop_get_proc_state(procState, pid);
                    if (procState && procState.cmd) {
                        let str = '';
                        for (let i = 0; i < procState.cmd.length; i++) {
                            if (procState.cmd[i] === 0)
                                break;
                            str += String.fromCharCode(procState.cmd[i]);
                        }
                        cmd = str ? `[${str}]` : cmd;
                    }
                }
                if (!cmd) {
                    continue;
                }
                process = {
                    pid: pid,
                    exec: Utils.extractCommandName(cmd),
                    cmd: cmd,
                    notSeen: 0,
                };
                this.topProcessesCache.setProcess(process);
            }
            GTop.glibtop_get_proc_io(io, pid);
            const currentRead = io.disk_rbytes;
            const currentWrite = io.disk_wbytes;
            const previous = this.previousPidsIO.get(pid);
            this.previousPidsIO.set(pid, {
                read: currentRead,
                write: currentWrite,
                time: GLib.get_monotonic_time(),
            });
            if (!previous)
                continue;
            const { read: previousRead, write: previousWrite, time: previousTime } = previous;
            const read = Math.round((currentRead - previousRead) /
                ((GLib.get_monotonic_time() - previousTime) / 1000000));
            const write = Math.round((currentWrite - previousWrite) /
                ((GLib.get_monotonic_time() - previousTime) / 1000000));
            if (read + write === 0)
                continue;
            topProcesses.push({ process, read, write });
        }
        topProcesses.sort((a, b) => b.read + b.write - (a.read + a.write));
        topProcesses.splice(StorageMonitor.TOP_PROCESSES_LIMIT);
        for (const pid of this.previousPidsIO.keys()) {
            if (!seenPids.includes(pid))
                this.previousPidsIO.delete(pid);
        }
        this.topProcessesCache.updateNotSeen(seenPids);
        this.setUsageValue('topProcesses', topProcesses);
        return true;
    }
    async updateStorageIOTop(data) {
        if (data.exit) {
            this.notify('topProcessesIOTopStop');
            return;
        }
        if (!data.result)
            return;
        try {
            const output = data.result;
            const lines = output.split('\n');
            const topProcesses = [];
            const parseNumber = (value) => parseFloat(value.replace(',', '.'));
            for (const line of lines) {
                const fields = line.trim().split(/\s+/);
                if (fields.length < 9 || !Utils.isNumeric(fields[0])) {
                    continue;
                }
                let commandIndex;
                if (fields[7] === '?unavailable?')
                    commandIndex = 8;
                else if (fields[8] === '%' && fields[10] === '%')
                    commandIndex = 11;
                else
                    continue;
                if (fields.length <= commandIndex)
                    continue;
                const pid = parseInt(fields[0]);
                const read = parseNumber(fields[3]) * 1024;
                const write = parseNumber(fields[5]) * 1024;
                const command = fields.slice(commandIndex).join(' ');
                topProcesses.push({
                    process: {
                        pid,
                        exec: command.split(' ')[0],
                        cmd: command,
                    },
                    read,
                    write,
                });
            }
            topProcesses.sort((a, b) => b.read + b.write - (a.read + a.write));
            topProcesses.splice(StorageMonitor.TOP_PROCESSES_LIMIT);
            this.setUsageValue('topProcessesIOTop', topProcesses);
            this.notify('topProcessesIOTop', topProcesses);
        }
        catch (e) {
            Utils.error('Error updating storage IO top', e);
        }
    }
    async getCachedDisk(device) {
        if (this.disksCache.has(device))
            return this.disksCache.get(device);
        const disks = await Utils.listDisksAsync(this.updateMountpointCache);
        const disk = disks.get(device);
        if (!disk || !disk.mountpoints || disk.mountpoints.length === 0)
            return undefined;
        this.disksCache.set(device, disk);
        return disk;
    }
    async updateStorageInfo() {
        try {
            const path = await Utils.getLsblkPathAsync();
            if (path === false)
                return false;
            const result = await Utils.runAsyncCommand(`${path}lsblk -JbO`, this.updateStorageInfoTask);
            const map = new Map();
            const blockToInfo = (data) => {
                const deviceInfo = {};
                for (const key in data) {
                    if (Object.prototype.hasOwnProperty.call(data, key) && key !== 'children') {
                        deviceInfo[key] = data[key];
                    }
                }
                return deviceInfo;
            };
            if (result) {
                const json = JSON.parse(result);
                if (json.blockdevices && json.blockdevices.length > 0) {
                    for (const device of json.blockdevices) {
                        const id = device.id;
                        const deviceInfo = blockToInfo(device);
                        map.set(id, deviceInfo);
                        if (device.children && device.children.length > 0) {
                            for (const child of device.children) {
                                const childID = child.id;
                                const childInfo = blockToInfo(child);
                                childInfo.parent = deviceInfo;
                                map.set(childID, childInfo);
                            }
                        }
                    }
                }
                this.setUsageValue('storageInfo', map);
                return true;
            }
        }
        catch (e) {
            Utils.error('Error updating storage info', e);
        }
        return false;
    }
    destroy() {
        this.stop();
        Config.clear(this);
        this.updateMountpointCache?.cancel();
        this.updateMountpointCache = undefined;
        this.updateStorageUsageTask?.cancel();
        this.updateStorageUsageTask = undefined;
        this.updateTopProcessesTask?.cancel();
        this.updateTopProcessesTask = undefined;
        this.updateStorageIOTask?.cancel();
        this.updateStorageIOTask = undefined;
        this.updateStorageInfoTask?.cancel();
        this.updateStorageInfoTask = undefined;
        this.updateStorageIOTopTask?.destroy();
        this.updateStorageIOTopTask = undefined;
        this.previousStorageIO = undefined;
        this.previousDetailedStorageIO = undefined;
        this.previousPidsIO = undefined;
        this.topProcessesCache?.reset();
        this.topProcessesCache = undefined;
        this.disksCache = undefined;
        this.diskChecks = undefined;
        this.sectorSizes = undefined;
        super.destroy();
    }
}

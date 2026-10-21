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
import Gio from 'gi://Gio';
import CancellableTaskManager from './cancellableTaskManager.js';
export default class ContinuousTaskManager {
    constructor() {
        this.output = '';
        this.listeners = new Map();
        this.exited = false;
    }
    start(command, options) {
        this.stop();
        const task = new CancellableTaskManager();
        this.currentTask = task;
        this.command = command;
        this.options = options;
        this.output = '';
        this.exited = false;
        task.run(this.task.bind(this))
            .catch(() => {
            this.exit(task);
        })
            .finally(() => {
            if (this.currentTask === task)
                this.stop();
        });
        if (this.options?.flush?.interval) {
            this.startTimer();
        }
    }
    callback(data) {
        if (this.exited && !data.exit)
            return;
        this.listeners.forEach((callback, _subject) => {
            callback(data);
        });
    }
    exit(generation) {
        if (this.currentTask !== undefined && this.currentTask !== generation)
            return;
        if (this.exited)
            return;
        this.exited = true;
        this.stopTimer();
        this.callback({ exit: true });
    }
    task() {
        const generation = this.currentTask;
        const cancellable = generation?.cancellable || null;
        return new Promise((resolve, reject) => {
            if (!this.command) {
                reject('No command or script provided');
                return;
            }
            let argv;
            if (this.options?.script) {
                argv = ['bash', '-c', this.command];
            }
            else {
                try {
                    argv = GLib.shell_parse_argv(this.command);
                    if (!argv[0])
                        throw new Error('Invalid command');
                    argv = argv[1];
                }
                catch (e) {
                    reject(`Failed to parse command: ${e.message}`);
                    return;
                }
            }
            if (!argv) {
                reject('Failed to parse command');
                return;
            }
            let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
            if (this.options?.stdin) {
                flags |= Gio.SubprocessFlags.STDIN_PIPE;
            }
            const proc = new Gio.Subprocess({ argv, flags });
            if (!proc) {
                reject('Failed to create subprocess');
                return;
            }
            try {
                const init = proc.init(cancellable);
                if (!init) {
                    reject('Failed to initialize subprocess');
                    return;
                }
            }
            catch (e) {
                reject(`Failed to initialize subprocess: ${e.message}`);
                return;
            }
            generation?.setSubprocess(proc);
            const pipeOut = proc.get_stdout_pipe();
            if (!pipeOut) {
                reject('Failed to get stdout pipe');
                return;
            }
            const pipeErr = proc.get_stderr_pipe();
            if (pipeErr) {
                const stderrStream = new Gio.DataInputStream({
                    baseStream: pipeErr,
                    closeBaseStream: true,
                });
                this.drainStream(cancellable, stderrStream);
            }
            const stdoutStream = new Gio.DataInputStream({
                baseStream: pipeOut,
                closeBaseStream: true,
            });
            this.readOutput(generation, cancellable, resolve, reject, stdoutStream);
        });
    }
    drainStream(cancellable, stream) {
        stream.read_line_async(GLib.PRIORITY_LOW, cancellable, (s, result) => {
            try {
                if (s === null)
                    throw new Error('Stream invalid');
                const [line] = s.read_line_finish_utf8(result);
                if (line !== null) {
                    this.drainStream(cancellable, stream);
                    return;
                }
            }
            catch (_) {
            }
            try {
                stream.close(null);
            }
            catch (_) {
            }
        });
    }
    readOutput(generation, cancellable, resolve, reject, stdout) {
        stdout.read_line_async(GLib.PRIORITY_LOW, cancellable, (stream, result) => {
            try {
                if (stream === null) {
                    throw new Error('Stream invalid');
                }
                const [line] = stream.read_line_finish_utf8(result);
                if (line !== null) {
                    if (this.output.length + line.length > 5 * 1024 * 1024) {
                        if (this.output.length > 0) {
                            this.callback({ result: this.output, exit: false });
                        }
                        this.output = '';
                    }
                    if (this.output.length)
                        this.output += '\n' + line;
                    else
                        this.output += line;
                    if (this.options?.flush?.always) {
                        this.callback({ result: this.output, exit: false });
                        this.output = '';
                    }
                    else if (this.options?.flush?.match &&
                        (() => {
                            this.options.flush.match.lastIndex = 0;
                            return this.options.flush.match.test(line);
                        })()) {
                        this.callback({ result: this.output, exit: false });
                        this.output = '';
                    }
                    else if (this.options?.flush?.idle) {
                        this.startTimer();
                    }
                    else if (this.options?.flush?.trigger &&
                        line.includes(this.options.flush.trigger)) {
                        this.callback({ result: this.output, exit: false });
                        this.output = '';
                    }
                    this.readOutput(generation, cancellable, resolve, reject, stdout);
                }
                else {
                    this.exit(generation);
                    try {
                        stdout.close(null);
                    }
                    catch (e) {
                    }
                    resolve(true);
                }
            }
            catch (e) {
                this.exit(generation);
                try {
                    stdout.close(null);
                }
                catch (err) {
                }
                resolve(false);
            }
        });
    }
    listen(subject, callback) {
        this.listeners.set(subject, callback);
    }
    unlisten(subject) {
        if (this.listeners.has(subject)) {
            this.listeners.delete(subject);
        }
    }
    startTimer() {
        this.stopTimer();
        if (!this.options?.flush?.interval && !this.options?.flush?.idle)
            return;
        const time = this.options?.flush?.idle ?? this.options?.flush?.interval ?? 1000;
        this.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, time, () => {
            if (this.exited) {
                this.timerId = undefined;
                return GLib.SOURCE_REMOVE;
            }
            if (this.output.length > 0) {
                this.callback({ result: this.output, exit: false });
                this.output = '';
            }
            if (this.options?.flush?.idle) {
                this.timerId = undefined;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
    stopTimer() {
        if (this.timerId !== undefined) {
            GLib.source_remove(this.timerId);
            this.timerId = undefined;
        }
    }
    stop() {
        this.stopTimer();
        this.currentTask?.cancel();
        this.currentTask = undefined;
        this.output = '';
    }
    get isRunning() {
        return this.currentTask?.isRunning || false;
    }
    destroy() {
        this.stop();
        this.listeners.clear();
    }
}

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
export default class CommandHelper {
    static async runCommand(command, cancellableTaskManager) {
        let proc = null;
        let stdoutStream = null;
        let stderrStream = null;
        const cancellable = cancellableTaskManager?.cancellable || null;
        try {
            const [ok, argv] = GLib.shell_parse_argv(command);
            if (!ok || !argv || argv.length === 0) {
                throw new Error(`Failed to parse CommandHelper: "${command}"`);
            }
            const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
            proc = new Gio.Subprocess({ argv, flags });
            try {
                const init = proc.init(cancellable);
                if (!init) {
                    throw new Error('Failed to initialize CommandHelper');
                }
            }
            catch (e) {
                throw new Error(`Failed to initialize CommandHelper: ${e.message}`);
            }
            cancellableTaskManager?.setSubprocess(proc);
            stdoutStream = proc.get_stdout_pipe();
            stderrStream = proc.get_stderr_pipe();
            const stdoutPromise = CommandHelper.readAll(stdoutStream, cancellable);
            const stderrPromise = CommandHelper.readAll(stderrStream, cancellable);
            const waitPromise = new Promise((resolve, reject) => {
                proc.wait_async(cancellable, (_source, res) => {
                    try {
                        if (!proc.wait_finish(res)) {
                            reject(new Error('Wait failed'));
                        }
                        else if (proc.get_if_exited()) {
                            resolve(proc.get_exit_status());
                        }
                        else {
                            reject(new Error('Command terminated before exiting normally'));
                        }
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            const [exitStatus, stdoutContent, stderrContent] = await Promise.all([
                waitPromise,
                stdoutPromise,
                stderrPromise,
            ]);
            if (exitStatus !== 0) {
                throw new Error(`CommandHelper failed with exit status ${exitStatus}: ${stderrContent.trim()}`);
            }
            if (!stdoutContent)
                throw new Error('No output');
            return stdoutContent.trim();
        }
        catch (e) {
            proc.force_exit();
            throw new Error(`Failed to run CommandHelper: ${e.message}`);
        }
        finally {
            try {
                stdoutStream?.close(null);
            }
            catch (_) {
            }
            try {
                stderrStream?.close(null);
            }
            catch (_) {
            }
        }
    }
    static async readAll(stream, cancellable) {
        if (!stream)
            return '';
        const chunks = [];
        let totalLength = 0;
        const bufferSize = 8192;
        let bytes = null;
        do {
            bytes = await new Promise((resolve, reject) => {
                stream.read_bytes_async(bufferSize, GLib.PRIORITY_LOW, cancellable, (_stream, asyncResult) => {
                    try {
                        const result = stream.read_bytes_finish(asyncResult);
                        resolve(result);
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            if (bytes && bytes.get_size() > 0) {
                const chunk = bytes.toArray();
                chunks.push(chunk);
                totalLength += chunk.length;
            }
        } while (bytes && bytes.get_size() > 0);
        if (totalLength === 0)
            return '';
        const fullBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            fullBuffer.set(chunk, offset);
            offset += chunk.length;
        }
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(fullBuffer);
    }
}

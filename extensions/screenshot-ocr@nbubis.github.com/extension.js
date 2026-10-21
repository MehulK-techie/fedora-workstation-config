import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class OcrScreenshotExtension extends Extension {
    enable() {
        this._signalId = 0;
        this._ocrCancellable = null;
        this._openOverride = false;
        this._originalOpen = null;

        // 1. Try to connect if UI already exists
        if (Main.screenshotUI) {
            this._connectSignal();
        } 
        
        // 2. Monkey-patch the opener to catch lazy-loading
        // We do this regardless of step 1 to ensure re-connections if the UI is destroyed/recreated
        this._originalOpen = Main.openScreenshotUI;
        this._myOpenWrapper = (...args) => {
            // Call original
            this._originalOpen.call(Main, ...args);
            
            // Connect signal if not already connected
            if (Main.screenshotUI && !this._signalId) {
                this._connectSignal();
            }
        };

        Main.openScreenshotUI = this._myOpenWrapper;
        this._openOverride = true;
    }

    _connectSignal() {
        if (this._signalId) return;

        console.debug(`[${this.metadata.uuid}] Connecting to screenshot-taken signal`);
        this._signalId = Main.screenshotUI.connect('screenshot-taken', (ui, file) => {
            if (file) {
                this._runTesseract(file.get_path());
            }
        });
    }

    _runTesseract(filePath) {
        try {
            // Cancel any previous running OCR tasks to prevent overlap
            if (this._ocrCancellable) {
                this._ocrCancellable.cancel();
            }
            this._ocrCancellable = new Gio.Cancellable();

            let proc = new Gio.Subprocess({
                argv: ['tesseract', filePath, 'stdout'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });

            proc.init(this._ocrCancellable);

            proc.communicate_utf8_async(null, this._ocrCancellable, (proc, res) => {
                try {
                    let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);

                    if (ok && stdout) {
                        let text = stdout.trim();
                        if (text) {
                            this._copyToClipboard(text);
                        } 
                    } else {
                        // Only log real errors, not cancellations
                        if (!stderr.includes('Interrupted system call')) {
                            console.debug(`[${this.metadata.uuid}] Tesseract stderr: ${stderr}`);
                        }
                    }
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error(`[${this.metadata.uuid}] Tesseract failed: ${e.message}`);
                    }
                }
            });
        } catch (e) {
            console.error(`[${this.metadata.uuid}] Failed to launch subprocess: ${e.message}`);
        }
    }

    _copyToClipboard(text) {
        let clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    disable() {
        // 1. Cancel any running OCR process
        if (this._ocrCancellable) {
            this._ocrCancellable.cancel();
            this._ocrCancellable = null;
        }

        // 2. Disconnect signal
        if (Main.screenshotUI && this._signalId) {
            Main.screenshotUI.disconnect(this._signalId);
            this._signalId = 0;
        }

        // 3. Restore Main.openScreenshotUI safely
        if (this._openOverride) {
            // Only restore if the current function is strictly OUR wrapper.
            // If someone else patched it after us, restoring ours would break theirs.
            if (Main.openScreenshotUI === this._myOpenWrapper) {
                Main.openScreenshotUI = this._originalOpen;
            } else {
                console.warn(`[${this.metadata.uuid}] Main.openScreenshotUI was modified by another extension; skipping restore.`);
            }
            
            this._originalOpen = null;
            this._myOpenWrapper = null;
            this._openOverride = false;
        }
    }
}

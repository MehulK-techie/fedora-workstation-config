// MK Shell Engine: more on GNOME's "Screenshot Captured" notification. In
// place of its single Show in Files: Annotate (Swappy or Satty when
// installed; without one, the picture opens in its viewer and the button says
// Open), OCR Text (Tesseract reads the screenshot; the text goes to the
// clipboard and a toast says so) and Open Folder (Screenshots, the new one
// selected). Clicking the notification still opens the picture.
//
// GNOME's own notification, picked up as it's posted (before its banner is
// drawn); the file is the newest picture in the Screenshots folder.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const _ = s => Gettext.domain('gnome-shell').gettext(s);
const ANNOTATORS = [['swappy', ['-f']], ['satty', ['--filename']]];

function screenshotsDir() {
    const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.get_home_dir();
    return Gio.File.new_for_path(GLib.build_filenamev([pictures, _('Screenshots')]));
}

// the picture just saved: the newest in the folder, from the last 15 seconds
function newestShot() {
    const dir = screenshotsDir();
    let best = null, bestTime = 0;
    try {
        const list = dir.enumerate_children('standard::name,standard::content-type,time::modified',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = list.next_file(null))) {
            if (!info.get_content_type()?.startsWith('image/'))
                continue;
            const t = info.get_attribute_uint64('time::modified');
            if (t > bestTime) {
                bestTime = t;
                best = dir.get_child(info.get_name());
            }
        }
    } catch {
        return null;
    }
    return best && Date.now() / 1000 - bestTime < 15 ? best : null;
}

function launch(argv) {
    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
}

export class ScreenshotActions {
    constructor() {
        this._watched = new Map();
        this._trayId = Main.messageTray.connect('source-added', (_t, source) => this._watch(source));
        for (const source of Main.messageTray.getSources())
            this._watch(source);
    }

    _watch(source) {
        if (this._watched.has(source))
            return;
        const ids = [
            source.connect('notification-added', (_s, notification) => this._extend(notification)),
            source.connect('destroy', () => this._watched.delete(source)),
        ];
        this._watched.set(source, ids);
    }

    _extend(notification) {
        if (notification.title !== _('Screenshot Captured'))
            return;
        const file = newestShot();
        if (!file)
            return;                           // (not saved to disk: GNOME's notification as it is)
        const path = file.get_path();
        const annotator = ANNOTATORS.find(([bin]) => GLib.find_program_in_path(bin));
        notification.clearActions();
        if (annotator)
            notification.addAction('Annotate', () => launch([annotator[0], ...annotator[1], path]));
        else
            notification.addAction('Open', () => Gio.app_info_launch_default_for_uri(file.get_uri(),
                global.create_app_launch_context(0, -1)));
        notification.addAction('OCR Text', () => this._ocr(path));
        notification.addAction('Open Folder', () => {
            const app = Gio.app_info_get_default_for_type('inode/directory', false);
            app?.launch([file], global.create_app_launch_context(0, -1));      // (Files selects it)
        });
    }

    // the screenshot's text onto the clipboard
    _ocr(path) {
        if (!GLib.find_program_in_path('tesseract')) {
            Main.notify('OCR needs Tesseract', 'Install it with: sudo dnf install tesseract tesseract-langpack-eng');
            return;
        }
        let proc;
        try {
            proc = Gio.Subprocess.new(['tesseract', path, '-', '--psm', '3'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            Main.notify('OCR failed', e.message);
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                const text = (out ?? '').replace(/\f/g, '').trim();
                if (!text) {
                    Main.notify('No text found', 'Tesseract found no text in that screenshot.');
                    return;
                }
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                Main.notify('Text copied to clipboard', text.length > 90 ? `${text.slice(0, 90)}…` : text);
            } catch (e) {
                Main.notify('OCR failed', e.message);
            }
        });
    }

    destroy() {
        Main.messageTray.disconnect(this._trayId);
        for (const [source, ids] of this._watched)
            ids.forEach(id => source.disconnect(id));
        this._watched.clear();
    }
}

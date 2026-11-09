// MK Shell Engine: an instant full-screen screenshot from inside the shell (the
// Quick Settings Screenshot tile): the whole screen, saved as
// ~/Pictures/Screenshots/Screenshot_YYYY-MM-DD_HH-MM-SS.png and copied to the
// clipboard as a PNG (Ctrl+V pastes it at once), with GNOME's shutter sound and
// a notification. The keys stay GNOME's own (Shift+Print the same, instantly;
// Print and Super+Shift+S pick an area).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_stage_to_content');
Gio._promisify(Shell.Screenshot, 'composite_to_stream');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

function target() {
    const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']);
    const dir = GLib.build_filenamev([pictures, 'Screenshots']);
    GLib.mkdir_with_parents(dir, 0o755);
    const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d_%H-%M-%S');
    for (let i = 0; ; i++) {
        const file = Gio.File.new_for_path(GLib.build_filenamev([dir, `Screenshot_${stamp}${i ? `-${i}` : ''}.png`]));
        if (!file.query_exists(null))
            return file;
    }
}

// the screenshot's file (or throws)
export async function instantScreenshot() {
    const shooter = new Shell.Screenshot();
    const [content] = await shooter.screenshot_stage_to_content();
    const stream = Gio.MemoryOutputStream.new_resizable();
    await Shell.Screenshot.composite_to_stream(content.get_texture(), 0, 0, -1, -1, 1, null, 0, 0, 1, stream);
    stream.close(null);
    const bytes = stream.steal_as_bytes();
    // the clipboard first: it works even if the disk is full
    St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
    const file = target();
    await file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null);
    try {
        global.display.get_sound_player().play_from_file(
            Gio.File.new_for_path(`${global.datadir}/sounds/screen-capture.oga`), 'Screenshot taken', null);
    } catch {}
    Main.notify('Screenshot saved & copied to clipboard', file.get_basename());
    return file.get_path();
}

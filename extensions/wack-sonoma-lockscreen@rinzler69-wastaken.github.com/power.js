// MK: Sleep and Hibernate for the Finder menu, Quick Settings and the lock
// screen's power button. Hibernate runs ~/.local/bin/mk-hibernate (systemctl
// hibernate, falling back to suspend-then-hibernate or hybrid-sleep); if this
// computer can't hibernate yet it says how to set it up
// (scripts/setup-hibernate.sh). remap-sleep-to-hibernate makes this
// extension's Sleep buttons hibernate instead.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

const HIBERNATE = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'mk-hibernate']);

export function hibernate() {
    const argv = GLib.file_test(HIBERNATE, GLib.FileTest.IS_EXECUTABLE) ? [HIBERNATE] : ['systemctl', 'hibernate'];
    let proc;
    try {
        proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
        Main.notify('Hibernate', e.message);
        return;
    }
    proc.communicate_utf8_async(null, null, (p, res) => {
        try {
            const [, , err] = p.communicate_utf8_finish(res);
            if (!p.get_successful()) {
                Main.notify('Hibernate isn\'t set up',
                    (err?.trim().split('\n').pop() || 'systemctl hibernate failed') +
                    '\nSet it up once with: sudo scripts/setup-hibernate.sh');
            }
        } catch {}
    });
}

export function sleep(settings) {
    if (settings?.get_boolean('remap-sleep-to-hibernate'))
        hibernate();
    else
        SystemActions.getDefault().activateSuspend();
}

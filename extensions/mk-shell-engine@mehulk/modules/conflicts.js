// MK Shell Engine: which third-party extensions are on. The engine's dock and
// blur stand aside while Dash to Dock or Blur my Shell runs, and come up when
// they're switched off, without a restart.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const DASH_TO_DOCK = 'dash-to-dock@micxgx.gmail.com';
export const BLUR_MY_SHELL = 'blur-my-shell@aunetx';

const ACTIVE = 1;     // ExtensionState.ACTIVE (named ENABLED before GNOME 48)

export function isActive(uuid) {
    return Main.extensionManager.lookup(uuid)?.state === ACTIVE;
}

// Call CALLBACK whenever any extension starts or stops; returns a disconnect function.
export function watch(callback) {
    const id = Main.extensionManager.connect('extension-state-changed', () => callback());
    return () => Main.extensionManager.disconnect(id);
}

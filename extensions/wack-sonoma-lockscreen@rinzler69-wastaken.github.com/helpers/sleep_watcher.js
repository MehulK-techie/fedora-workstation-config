import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

/**
 * Reports system suspend/resume via logind's 'prepare-for-sleep'.
 * Only reports, what to do with the player is up to the caller:
 *  - onSleep()  : system is about to suspend
 *  - onResume() : system woke up
 */
export class SleepWatcher {
    constructor({ onSleep, onResume }) {
        this._onSleep = onSleep;
        this._onResume = onResume;

        this._loginManager = LoginManager.getLoginManager();
        this._loginManager.connectObject('prepare-for-sleep', (_manager, aboutToSleep) => {
            if (aboutToSleep)
                this._onSleep?.();
            else
                this._onResume?.();
        }, this);
    }

    destroy() {
        this._loginManager?.disconnectObject(this);
        this._loginManager = null;

        this._onSleep = null;
        this._onResume = null;
    }
}

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildPrefsWidget } from './prefs/pref.js';

export default class TouchpadGestureCustomizationPreferences extends ExtensionPreferences {

    fillPreferencesWindow(prefsWindow) {
        const UIDirPath = this.metadata.dir.get_child('ui').get_path() ?? '';
        const settings = this.getSettings();
        buildPrefsWidget(prefsWindow, settings, UIDirPath);
        return Promise.resolve();
    }

}

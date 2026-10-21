import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { TouchpadPinchGesture } from './pinchTracker.js';

var ShowNotificationListGestureState;

(function (ShowNotificationListGestureState) {
    ShowNotificationListGestureState[ShowNotificationListGestureState["PINCH_IN"] = -1] = "PINCH_IN";
    ShowNotificationListGestureState[ShowNotificationListGestureState["DEFAULT"] = 0] = "DEFAULT";
})(ShowNotificationListGestureState || (ShowNotificationListGestureState = {}));

export class ShowNotificationListExtension {

    constructor(nfingers) {
        this._pinchTracker = new TouchpadPinchGesture({
            nfingers: nfingers,
            allowedModes: Shell.ActionMode.NORMAL,
            pinchSpeed: 0.25,
        });
        this._pinchTracker.connect('begin', this.gestureBegin.bind(this));
        this._pinchTracker.connect('end', this.gestureEnd.bind(this));
    }

    destroy() {
        this._pinchTracker.destroy();
    }

    gestureBegin(tracker) {
        tracker.confirmPinch(0, [
            ShowNotificationListGestureState.PINCH_IN,
            ShowNotificationListGestureState.DEFAULT,
        ], ShowNotificationListGestureState.DEFAULT);
    }

    gestureEnd(_tracker, _duration, progress) {
        switch (progress) {
            case ShowNotificationListGestureState.DEFAULT:
                break;
            case ShowNotificationListGestureState.PINCH_IN:
                this._invokeGestureCompleteAction();
        }
    }

    _invokeGestureCompleteAction() {
        Main.panel.toggleCalendar();
    }

}

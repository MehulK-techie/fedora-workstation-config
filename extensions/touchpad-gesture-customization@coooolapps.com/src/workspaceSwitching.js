import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ExtSettings, OverviewControlsState } from '../constants.js';
import { createSwipeTracker, TouchpadSwipeGesture } from './swipeTracker.js';
import { WorkspaceSwitchingState } from '../common/settings.js';

function connectTouchpadEventToTracker(touchpadGesture) {
     
    global.stage.connectObject('captured-event::touchpad', touchpadGesture._handleEvent.bind(touchpadGesture), touchpadGesture);
}

function disconnectTouchpadEventFromTracker(touchpadGesture) {
     
    global.stage.disconnectObject(touchpadGesture);
}

class WorkspaceAnimationModifier {

    constructor(workspaceSwitchingStates, nfingers, wm, orientation) {
        this._firstVal = 0;
        this._lastVal = 0;
        this._progress = 0;
        this._workspaceAnimation = wm._workspaceAnimation;
        this._swipeTracker = createSwipeTracker(global.stage, nfingers, Shell.ActionMode.NORMAL, orientation ?? Clutter.Orientation.HORIZONTAL, ExtSettings.FOLLOW_NATURAL_SCROLL, 1);
        this._workspaceSwitchingStates = workspaceSwitchingStates;
    }

    apply() {
        if (this._workspaceAnimation._swipeTracker._touchpadGesture)
            disconnectTouchpadEventFromTracker(this._workspaceAnimation._swipeTracker._touchpadGesture);
        this._swipeTracker.connect('begin', this._gestureBegin.bind(this));
        this._swipeTracker.connect('update', this._gestureUpdate.bind(this));
        this._swipeTracker.connect('end', this._gestureEnd.bind(this));
    }

    _gestureBegin(tracker, monitor) {
        this._modifySnapPoints(tracker, shallowTracker => {
            this._workspaceAnimation._switchWorkspaceBegin(shallowTracker, monitor);
        });
    }

    _gestureUpdate(tracker, progress) {
        if (progress < this._firstVal)
            progress = this._firstVal - (this._firstVal - progress) * 0.05;
        else if (progress > this._lastVal)
            progress = this._lastVal + (progress - this._lastVal) * 0.05;
        this._progress = progress;
        this._workspaceAnimation._switchWorkspaceUpdate(tracker, progress);
    }

    _gestureEnd(tracker, duration, progress) {
        switch (this._workspaceSwitchingStates) {
            case WorkspaceSwitchingState.CYCLIC:
                if (this._progress < this._firstVal) {
                    progress =
                        progress >= this._firstVal
                            ? this._firstVal
                            : this._lastVal;
                }
                else if (this._progress > this._lastVal) {
                    progress =
                        progress <= this._lastVal
                            ? this._lastVal
                            : this._firstVal;
                }
                else {
                    progress = Math.clamp(progress, this._firstVal, this._lastVal);
                }

                break;
            case WorkspaceSwitchingState.DEFAULT:
                progress = Math.clamp(progress, this._firstVal, this._lastVal);
                break;
        }

        this._workspaceAnimation._switchWorkspaceEnd(tracker, duration, progress);
    }

    _modifySnapPoints(tracker, callback) {
        const _tracker = {
            orientation: tracker.orientation,
            confirmSwipe: (distance, snapPoints, currentProgress, cancelProgress) => {
                this._firstVal = snapPoints[0];
                this._lastVal = snapPoints[snapPoints.length - 1];
                snapPoints.unshift(this._firstVal - 1);
                snapPoints.push(this._lastVal + 1);
                tracker.confirmSwipe(distance, snapPoints, currentProgress, cancelProgress);
            },
        };
        callback(_tracker);
    }

    destroy() {
        const swipeTracker = this._workspaceAnimation._swipeTracker;
        if (swipeTracker._touchpadGesture)
            connectTouchpadEventToTracker(swipeTracker._touchpadGesture);

        if (this._swipeTracker) {
            this._swipeTracker.destroy();
            this._swipeTracker.enabled = false;
        }
    }

}

export class WorkspaceSwitchingExtension {

    constructor() {
        this._stateAdjustment =
            Main.overview._overview._controls._stateAdjustment;

        // First tracker controls workspace switching in overview
        // Second tracker controls app page switching in app grid
        this._swipeTrackers = [
            {
                swipeTracker: Main.overview._overview._controls._workspacesDisplay
                    ._swipeTracker,
                nfingers: [3, 4],
                disableOldGesture: true,
                followNaturalScroll: ExtSettings.FOLLOW_NATURAL_SCROLL,
                modes: Shell.ActionMode.OVERVIEW,
                gestureSpeed: 1,
                checkAllowedGesture: (event) => {
                    if (Main.overview._overview._controls._searchController
                        .searchActive)
                        return false;
                    if (event.get_touchpad_gesture_finger_count() === 4)
                        return true;
                    else
                        return (this._stateAdjustment.value ===
                            OverviewControlsState.WINDOW_PICKER);
                },
            },
            {
                swipeTracker: Main.overview._overview._controls._appDisplay._swipeTracker,
                nfingers: [3],
                disableOldGesture: true,
                followNaturalScroll: ExtSettings.FOLLOW_NATURAL_SCROLL,
                modes: Shell.ActionMode.OVERVIEW,
                checkAllowedGesture: () => {
                    if (Main.overview._overview._controls._searchController
                        .searchActive)
                        return false;
                    return (this._stateAdjustment.value ===
                        OverviewControlsState.APP_GRID);
                },
            },
        ];
    }

    setVerticalWorkspaceAnimationModifier(nfingers, workspaceSwitchingState) {
        this._verticalWorkspaceAnimationModifier =
            new WorkspaceAnimationModifier(workspaceSwitchingState, nfingers, Main.wm, Clutter.Orientation.VERTICAL);
    }

    setHorizontalWorkspaceAnimationModifier(nfingers, workspaceSwitchingState) {
        this._horizontalWorkspaceAnimationModifier =
            new WorkspaceAnimationModifier(workspaceSwitchingState, nfingers, Main.wm, Clutter.Orientation.HORIZONTAL);
    }

    apply() {
        this._verticalWorkspaceAnimationModifier?.apply();
        this._horizontalWorkspaceAnimationModifier?.apply();
        this._swipeTrackers.forEach(entry => {
            const { swipeTracker, nfingers, disableOldGesture, followNaturalScroll, modes, checkAllowedGesture, } = entry;
            const gestureSpeed = entry.gestureSpeed ?? 1;
            const touchpadGesture = new TouchpadSwipeGesture(nfingers, modes, swipeTracker.orientation, followNaturalScroll, checkAllowedGesture, gestureSpeed);
            this._attachGestureToTracker(swipeTracker, touchpadGesture, disableOldGesture);
        });
    }

    destroy() {
        this._swipeTrackers.reverse().forEach(entry => {
            const { swipeTracker, disableOldGesture } = entry;
            swipeTracker._touchpadGesture?.destroy();
            swipeTracker._touchpadGesture = swipeTracker._oldTouchpadGesture;
            swipeTracker._oldTouchpadGesture = undefined;
            if (swipeTracker._touchpadGesture && disableOldGesture)
                connectTouchpadEventToTracker(swipeTracker._touchpadGesture);
        });
        this._verticalWorkspaceAnimationModifier?.destroy();
        this._horizontalWorkspaceAnimationModifier?.destroy();
    }

    _attachGestureToTracker(swipeTracker, touchpadSwipeGesture, disablePrevious) {
        if (swipeTracker._touchpadGesture && disablePrevious) {
            disconnectTouchpadEventFromTracker(swipeTracker._touchpadGesture);
            swipeTracker._oldTouchpadGesture = swipeTracker._touchpadGesture;
        }

        swipeTracker._touchpadGesture = touchpadSwipeGesture;
        swipeTracker._touchpadGesture.connect('begin', swipeTracker._beginTouchpadGesture.bind(swipeTracker));
        swipeTracker._touchpadGesture.connect('update', swipeTracker._updateTouchpadGesture.bind(swipeTracker));
        swipeTracker._touchpadGesture.connect('end', swipeTracker._endTouchpadGesture.bind(swipeTracker));
        swipeTracker.bind_property('enabled', swipeTracker._touchpadGesture, 'enabled', 0);
        swipeTracker.bind_property('orientation', swipeTracker._touchpadGesture, 'orientation', GObject.BindingFlags.SYNC_CREATE);
    }

}

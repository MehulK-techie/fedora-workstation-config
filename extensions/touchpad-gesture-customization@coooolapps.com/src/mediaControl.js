import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import { TouchpadSwipeGesture } from './swipeTracker.js';
import { getVirtualKeyboard } from './utils/keyboard.js';
import { ExtSettings } from '../constants.js';

export class MediaControlGestureExtension {

    /**
     * @param tapFingers finger counts that have a tap action; resting these
     * fingers doesn't toggle play/pause, since every tap starts with a rest
     */
    constructor(tapFingers = []) {
        this._verticalDelta = 0;
        this._horizontalDelta = 0;
        this._threshold = 50; // Threshold for swipe to trigger action
        this._tapFingers = tapFingers;
    }

    apply() {
        // Nothing special to apply on startup
    }

    destroy() {
        this._verticalConnectHandlers?.forEach(handle => this._verticalTouchpadSwipeTracker?.disconnect(handle));
        this._verticalConnectHandlers = undefined;
        this._verticalTouchpadSwipeTracker?.destroy();
        this._horizontalConnectHandlers?.forEach(handle => this._horizontalTouchpadSwipeTracker?.disconnect(handle));
        this._horizontalConnectHandlers = undefined;
        this._horizontalTouchpadSwipeTracker?.destroy();
    }

    setVerticalSwipeTracker(nfingers) {
        this._verticalTouchpadSwipeTracker = new TouchpadSwipeGesture(nfingers, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, Clutter.Orientation.VERTICAL, !ExtSettings.INVERT_MEDIA_DIRECTION // followNaturalScroll
        );
        this._verticalConnectHandlers = [
            this._verticalTouchpadSwipeTracker.connect('begin', () => {
                this._verticalDelta = 0;
            }),
            this._verticalTouchpadSwipeTracker.connect('update', (_gesture, _time, delta) => {
                this._verticalDelta += delta;
            }),
            this._verticalTouchpadSwipeTracker.connect('end', () => {
                if (this._verticalDelta > this._threshold) {
                    // Swipe Down (positive delta) -> Prev Track (reversed from original)
                    getVirtualKeyboard().sendKeys([Clutter.KEY_AudioPrev]);
                }
                else if (this._verticalDelta < -this._threshold) {
                    // Swipe Up (negative delta) -> Next Track (reversed from original)
                    getVirtualKeyboard().sendKeys([Clutter.KEY_AudioNext]);
                }
            }),
            this._verticalTouchpadSwipeTracker.connect('hold', (_gesture, _time, fingers) => {
                if (this._tapFingers.includes(fingers))
                    return;

                // Hold -> Play/Pause
                getVirtualKeyboard().sendKeys([Clutter.KEY_AudioPlay]);
            }),
        ];
    }

    setHorizontalSwipeTracker(nfingers) {
        this._horizontalTouchpadSwipeTracker = new TouchpadSwipeGesture(nfingers, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, Clutter.Orientation.HORIZONTAL, !ExtSettings.INVERT_MEDIA_DIRECTION // followNaturalScroll
        );
        this._horizontalConnectHandlers = [
            this._horizontalTouchpadSwipeTracker.connect('begin', () => {
                this._horizontalDelta = 0;
            }),
            this._horizontalTouchpadSwipeTracker.connect('update', (_gesture, _time, delta) => {
                this._horizontalDelta += delta;
            }),
            this._horizontalTouchpadSwipeTracker.connect('end', () => {
                if (this._horizontalDelta > this._threshold) {
                    // Swipe Right -> Prev Track
                    getVirtualKeyboard().sendKeys([Clutter.KEY_AudioPrev]);
                }
                else if (this._horizontalDelta < -this._threshold) {
                    // Swipe Left -> Next Track
                    getVirtualKeyboard().sendKeys([Clutter.KEY_AudioNext]);
                }
            }),
            this._horizontalTouchpadSwipeTracker.connect('hold', (_gesture, _time, fingers) => {
                if (this._tapFingers.includes(fingers))
                    return;

                // Hold -> Play/Pause
                getVirtualKeyboard().sendKeys([Clutter.KEY_AudioPlay]);
            }),
        ];
    }

}

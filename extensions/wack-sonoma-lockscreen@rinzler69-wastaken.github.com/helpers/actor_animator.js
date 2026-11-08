import Clutter from 'gi://Clutter';
import { Direction } from '../enums.js';
import { toDouble } from '../utils/base.js';

let instanceCounter = 0;

/**
 * Thin wrapper over Clutter.PropertyTransition: one transition per actor,
 * all controlled together. Transitions are reused for play, pause, stop and
 * reverse, and recreated only by rebind().
 *
 * State (position in ms, eased value, direction) is tracked from a single
 * "oracle": the first actor's transition. It is the only one with signals
 * connected, and the other actors are assumed to be within a frame of it.
 *
 * NOTE: On multi-monitor setups with different refresh rates, actors can
 * differ slightly in progress, so a rebind may desync them a little. The
 * difference is negligible and rebinds are rare, so code simplicity wins here.
 *
 * With no actors, every method is a no-op.
 *
 * The property can be a plain actor property ('opacity') or an effect
 * property, as accepted by ease_property
 * ('@effects.my-effect-name.factor').
 */
export class ActorAnimator {
    constructor({actors = [], property, from, to, duration, ease = Clutter.AnimationMode.LINEAR}) {
        this._property = property;

        this._fromNum = from;
        this._toNum = to;
        this._from = toDouble(from); // Converting to GObject.Double
        this._to = toDouble(to); // Converting to GObject.Double
        this._duration = duration;
        this._ease = ease;
        this._name = `actor-animator-${instanceCounter++}`;

        this._direction = Direction.FORWARD;
        this._playing = false;
        this._pos = 0; // position (elapsed time) in MS 
        this._eased = 0; // progress (eased value) between 0-1
        this._entries = []; // [{actor, transition}]
        this._eased = 0;

        this._adopt(actors);
    }

    /**
     * Starts (or continues) the animation from the current position.
     * @param {number} [direction] Direction.FORWARD or Direction.BACKWARD.
     *     Without an argument, continues in the last used direction.
     * @param {number} [delay] the delay before the start of animation in ms.
     *      Default: 0ms
     */
    play(direction = this._direction, delay=0) {
        this._direction = direction;
        this._playing = true;

        for (const {transition} of this._entries) {
            transition.pause();
            this._place(transition);
            transition.set_delay(delay);
            transition.start();
        }
    }

    pause() {
        this._playing = false;
        this._entries.forEach(e => e.transition.pause());
    }

    stop() {
        this._playing = false;
        this._direction = Direction.FORWARD;
        this._pos = 0;
        this._eased = 0;

        for (const {transition} of this._entries) {
            transition.pause();
            this._place(transition);
        }
    }

    /** @returns {number} Position in percent (0..100) based on elapsed time */
    get_progress() {
        return this._duration ? this._pos / this._duration * 100 : 0;
    }

    get_value() {
        return this._fromNum + (this._toNum - this._fromNum) * this._eased;
    }

    /**
     * Puts a transition at the saved direction and position
     */
    _place(transition) {
        // Direction first: Clutter moves the transition when it changes at
        // position 0, and advance() then puts it back
        transition.set_direction(this._direction);
        transition.advance(this._pos);
    }

    /**
     * Recreates the transitions on a new set of actors (for example after the
     * lock dialog rebuilt its wrappers). They jump to the saved position with
     * advance() and keep playing if the animator was playing.
     */
    rebind(actors) {
        this._release();
        this._adopt(actors);

        for (const {transition} of this._entries) {
            this._place(transition);

            if (this._playing)
                transition.start();
        }
    }

    _adopt(actors) {
        for (const actor of actors) {
            const transition = new Clutter.PropertyTransition({
                property_name: this._property,
                duration: this._duration,
                remove_on_complete: false,
            });
            transition.set_progress_mode(this._ease);
            transition.set_from(this._from);
            transition.set_to(this._to);

            const entry = {actor, transition};
            actor.connectObject('destroy', () => this._drop(entry), this);

            actor.add_transition(this._name, transition);   // starts immediately
            transition.pause();                             // no frame has run yet
            this._entries.push(entry);
        }

        this._watch();
    }

    _watch() {
        this._entries[0]?.transition.connectObject(
            'new-frame', (_t, ms) => {
                this._pos = ms;
                this._eased = _t.get_progress();
            },
            'completed', () => {
                // The elapsed time can't be trusted after completion
                this._pos = this._direction == Direction.FORWARD ? this._duration : 0;
                this._eased = this._direction == Direction.FORWARD ? 1 : 0;
                this._playing = false;
            },
            this
        );
    }

    _drop(entry) {
        const wasOracle = entry === this._entries[0];

        entry.transition.disconnectObject(this);
        this._entries = this._entries.filter(e => e !== entry);

        if (wasOracle)
            this._watch();
    }

    _release() {
        for (const {actor, transition} of this._entries) {
            transition.disconnectObject(this);
            actor.disconnectObject(this);
            actor.remove_transition(this._name);
        }
        this._entries = [];
    }

    destroy() {
        this._playing = false;
        this._release();
    }
}
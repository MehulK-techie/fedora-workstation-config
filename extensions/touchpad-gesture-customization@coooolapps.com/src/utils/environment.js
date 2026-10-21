/**
 *
 * @param actor
 * @param params
 */
export function easeActor(actor, params) {
    actor.ease(params);
}

/**
 *
 * @param actor
 * @param value
 * @param params
 */
export function easeAdjustment(actor, value, params) {
    actor.ease(value, params);
}

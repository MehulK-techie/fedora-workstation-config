import { PlaylistOrder, PlaylistStart } from '../enums.js';
import { amod, hash01, shuffleArray } from '../utils/base.js';

/**
 * List of videos with a position that only moves by +1/-1.
 * Stateless: the video at any index is computed from the index alone.
 *
 * Orders:
 *  - Sequential: plays the list in order, wrapping around
 *  - Shuffle: like sequential, but the list is shuffled once at creation
 *  - Random: every index picks a random video (seeded by the index), never the
 *    same one twice in a row. Even indices pick freely, odd ones avoid both neighbours
 *
 * Only increment()/decrement() move the position, next()/previous() just look ahead
 */
export class Playlist {
    constructor({
        videos, order = PlaylistOrder.SEQUENTIAL,
        start = PlaylistStart.FIRST, lastPlayed = '',
    }) {
        if (!videos?.length)
            throw new Error('Playlist: no videos');

        // Copy, shuffle() reorders it
        this._videos = [...videos];
        this._random = order === PlaylistOrder.RANDOM;
        // Different random sequence on every lock
        this._seed = Math.floor(Math.random() * 0x100000000);

        if (order != PlaylistOrder.SEQUENTIAL)
            this.shuffle();

        this._index = 0;
        // Position of the video at index 0
        this._start = this._startPosition(start, lastPlayed);
    }

    _startPosition(start, lastPlayed) {
        if (start === PlaylistStart.RANDOM)
            return Math.floor(Math.random() * this._videos.length);

        if (start === PlaylistStart.LAST_PLAYED)
            return Math.max(0, this._videos.indexOf(lastPlayed));
        
        return 0;
    }

    get size() {
        return this._videos.length;
    }

    /**
     * NOTE: The position stays the same, so current() may return another video
     */
    shuffle() {
        shuffleArray(this._videos);
    }

    current() {
        return this._videos[this._position(this._index)];
    }

    /**
     * @returns {string} Video after the current one, the position does not change
     */
    next() {
        return this._videos[this._position(this._index + 1)];
    }

    /**
     * @returns {string} Video before the current one, the position does not change
     */
    previous() {
        return this._videos[this._position(this._index - 1)];
    }

    increment() {
        this._index++;
    }

    decrement() {
        this._index--;
    }

    _position(index) {
        const size = this._videos.length;

        // With 2 videos alternating is the only order without repeats
        if (!this._random || size <= 2)
            return amod(index + this._start, size);

        if (index === 0)
            return this._start;

        // For even index generating random position based on seed and index
        if (amod(index, 2) === 0)
            return Math.floor(hash01(this._seed, index) * size);

        // For odd index we take the previous and next value and avoid bumping into them
        const left = this._position(index - 1);
        const right = this._position(index + 1);
        let pos = Math.floor(hash01(this._seed, index) * size);
        while (pos === left || pos === right)
            pos = amod(pos + 1, size);

        return pos;
    }
}

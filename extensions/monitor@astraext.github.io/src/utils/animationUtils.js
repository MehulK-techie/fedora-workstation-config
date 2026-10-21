/*!
 * Copyright (C) 2023 Lju
 *
 * This file is part of Astra Monitor extension for GNOME Shell.
 * [https://github.com/AstraExt/astra-monitor]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
import St from 'gi://St';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
class AnimationUtils {
    static get reducedMotion() {
        try {
            const reduce = St.ReducedMotion?.REDUCE;
            if (reduce === undefined)
                return false;
            return St.Settings.get().reducedMotion === reduce;
        }
        catch (_e) {
            return false;
        }
    }
    static getMenuParams(animate) {
        const shouldAnimate = animate && !AnimationUtils.reducedMotion;
        return AnimationUtils.useParamsObject ? { animate: shouldAnimate } : shouldAnimate;
    }
}
AnimationUtils.useParamsObject = (() => {
    const shellMajor = Number.parseInt(Config.PACKAGE_VERSION.split('.')[0], 10);
    return !Number.isNaN(shellMajor) && shellMajor >= 51;
})();
export default AnimationUtils;

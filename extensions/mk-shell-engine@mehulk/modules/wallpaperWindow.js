// MK Shell Engine: is this window a live wallpaper's player (never an app the user sees)?
//   bin/mk-live-wallpaper     Wayland app id "mk-live-wallpaper" (its prgname), title "MK Live Wallpaper"
//   the lock screen's mpv     app id / title "mk-live-wallpaper-lock" (WACK's core/mpv_player_process.js)
// and any window a player claimed (win._mkWallpaper, set the moment it appears). For a few frames
// after it appears, before it's made the desktop, such a window is still an ordinary one: these are
// kept out of the open animation, the dock (its icons and its intellihide) and the minimize glide,
// so nothing ever flashes, animates or shows up as an app.
export const WALLPAPER_IDS = ['mk-live-wallpaper', 'mk-live-wallpaper-lock'];
const TITLES = ['MK Live Wallpaper', 'mk-live-wallpaper', 'mk-live-wallpaper-lock'];

export function isWallpaperWindow(win) {
    if (!win)
        return false;
    if (win._mkWallpaper)
        return true;
    try {
        return WALLPAPER_IDS.includes((win.get_wm_class() ?? '').toLowerCase()) ||
            WALLPAPER_IDS.includes((win.get_gtk_application_id?.() ?? '').toLowerCase()) ||
            TITLES.includes(win.get_title() ?? '');
    } catch {
        return false;
    }
}

// a window's actor as it must be whenever an effect ends or fails: whole, in place, visible
export function restoreActor(actor) {
    try {
        actor.remove_all_transitions?.();
        actor.set_scale(1, 1);
        actor.set_translation(0, 0, 0);
        actor.set_pivot_point(0, 0);
        actor.opacity = 255;
        actor.show();
    } catch {}                                       // (an actor already gone)
}

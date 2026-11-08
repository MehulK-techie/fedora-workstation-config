import GLib from 'gi://GLib';

// MK: upstream WACK kept its wallpaper-colour cache in /var/tmp/wack, world-writable
// (1777), so that GDM's login screen could read it. This merge has no GDM part, so the
// cache is the user's alone: ~/.cache/wack-sonoma-lockscreen, created 0700 (no other
// account can write into it or plant links there).
export const WACK_BASE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'wack-sonoma-lockscreen']);

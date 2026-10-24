// Touchpad-friendly browsing for Firefox and Zen (MK Workstation).
// sync.sh keeps this in a marked block of each profile's user.js; your own
// lines in user.js outside the block are left alone.

// Two-finger swipe left/right goes back/forward, with the arrow indicator.
user_pref("widget.disable-swipe-tracker", false);
user_pref("browser.gesture.swipe.left", "Browser:BackOrBackDuplicate");
user_pref("browser.gesture.swipe.right", "Browser:ForwardOrForwardDuplicate");
// Kinetic (momentum) scrolling and a gentle bounce at the ends, like macOS.
user_pref("apz.gtk.kinetic_scroll.enabled", true);
user_pref("apz.overscroll.enabled", true);
user_pref("general.smoothScroll", true);
user_pref("general.smoothScroll.msdPhysics.enabled", true);
// Pinch to zoom the page (not just the text), smoothly.
user_pref("apz.allow_zooming", true);
user_pref("browser.gesture.pinch.in", "cmd_fullZoomReduce");
user_pref("browser.gesture.pinch.out", "cmd_fullZoomEnlarge");
// GPU rendering and video decoding: smoother scrolling, cooler laptop.
user_pref("gfx.webrender.all", true);
user_pref("media.ffmpeg.vaapi.enabled", true);
// Let Zen read chrome/userChrome.css (the MK accent block)
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

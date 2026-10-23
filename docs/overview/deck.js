// Build docs/MK-Workstation-Overview.pptx: the overview as a PowerPoint deck.
//
//   node docs/overview/deck.js ASSETS_DIR OUT.pptx
//
// ASSETS_DIR holds img/ (screenshots, some cropped), icons/ (white symbolic
// icons as PNG) and apps/ (app icons as PNG); docs/overview/build-deck.sh
// prepares it from docs/assets/screens and your icon theme, then applies
// the theme colours. Needs Node.js and the pptxgenjs npm package.
const path = require("path");
const pptxgen = require("pptxgenjs");

const ASSETS = process.argv[2];
const OUT = process.argv[3];
const img = n => path.join(ASSETS, "img", n + ".jpg");
const icon = n => path.join(ASSETS, "icons", n + ".png");
const app = n => path.join(ASSETS, "apps", n + ".png");
const GITHUB = "https://github.com/MehulK-techie/fedora-workstation-config";

const THEME = {
  name: "MK Workstation",
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0B1430", lt1: "FFFFFF", dk2: "5B677C", lt2: "EEF3FC",
    accent1: "2F80FF", accent2: "4FD3FF", accent3: "FFB020", accent4: "2ECC8F",
    accent5: "9B6BFF", accent6: "FF4D6D", hlink: "2F80FF", folHlink: "9B6BFF",
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.title = "MK Workstation: Fedora, finished";
pres.subject = "What MK Workstation adds to Fedora Workstation";
pres.author = "MK Workstation";
pres.company = "MK Workstation";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ---------------------------------------------------------------- layouts
pres.defineSlideMaster({
  title: "MK_TITLE",
  background: { color: THEME.colors.dk1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.4, w: 3.7, h: 1.6,
      fontSize: 48, bold: true, color: C.background1, valign: "top", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 3.25, w: 3.7, h: 1.2,
      fontSize: 16, color: C.accent2, valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "MK_CONTENT",
  background: { color: THEME.colors.lt1 },
  margin: [0.4, 0.5, 0.5, 0.5],
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.5, y: 0.28, w: 9, h: 0.3,
      fontSize: 11, bold: true, color: C.accent1, charSpacing: 2, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.55, w: 9, h: 0.7,
      fontSize: 30, bold: true, color: C.text1, valign: "top", align: "left", margin: 0 }, text: "" } },
    { text: { text: "MK Workstation", options: { x: 0.5, y: 5.22, w: 3, h: 0.25, fontSize: 9, color: C.text2, margin: 0 } } },
  ],
  slideNumber: { x: 9.0, y: 5.22, w: 0.5, h: 0.25, fontSize: 9, color: C.text2, align: "right" },
});
pres.defineSlideMaster({
  title: "MK_DARK",
  background: { color: THEME.colors.dk1 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.5, w: 8.8, h: 0.3,
      fontSize: 11, bold: true, color: C.accent2, charSpacing: 2, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.8, w: 8.8, h: 0.8,
      fontSize: 32, bold: true, color: C.background1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
});

// ---------------------------------------------------------------- helpers
let objectId = 0;
const oid = name => `${name}-${++objectId}`;

function content(section, kicker, title) {
  const s = pres.addSlide({ masterName: "MK_CONTENT", sectionTitle: section });
  s.addText(kicker.toUpperCase(), { placeholder: "kicker" });
  s.addText(title, { placeholder: "title" });
  return s;
}

function shot(s, file, x, y, w, h) {
  s.addImage({ path: img(file), x, y, w, h, rounding: false, objectName: oid(file),
    shadow: { type: "outer", color: "0B1430", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
}

function caption(s, text, x, y, w, color = C.text2) {
  s.addText(text, { x, y, w, h: 0.3, fontSize: 10, color, italic: true, isTextBox: true, margin: 0, objectName: oid("caption") });
}

// Icon in a filled circle, bold heading, line of explanation.
function row(s, iconName, head, body, x, y, w) {
  s.addShape(pres.shapes.OVAL, { x, y: y + 0.02, w: 0.42, h: 0.42, fill: { color: C.accent1 }, line: { type: "none" }, objectName: oid("dot") });
  s.addImage({ path: icon(iconName), x: x + 0.1, y: y + 0.12, w: 0.22, h: 0.22, objectName: oid("icon") });
  s.addText([
    { text: head, options: { bold: true, color: C.text1, breakLine: true } },
    { text: body, options: { color: C.text2 } },
  ], { x: x + 0.55, y: y - 0.04, w: w - 0.55, h: 0.62, fontSize: 14, valign: "top", margin: 0, isTextBox: true, paraSpaceAfter: 1, objectName: oid("row") });
}

function card(s, iconName, head, body, x, y, w, h) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: C.background2 }, line: { type: "none" }, objectName: oid("card") });
  s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: y + 0.2, w: 0.42, h: 0.42, fill: { color: C.accent1 }, line: { type: "none" }, objectName: oid("dot") });
  s.addImage({ path: icon(iconName), x: x + 0.3, y: y + 0.3, w: 0.22, h: 0.22, objectName: oid("icon") });
  s.addText([
    { text: head, options: { bold: true, color: C.text1, fontSize: 15, breakLine: true } },
    { text: body, options: { color: C.text2, fontSize: 12 } },
  ], { x: x + 0.2, y: y + 0.72, w: w - 0.4, h: h - 0.85, valign: "top", margin: 0, isTextBox: true, paraSpaceAfter: 3, objectName: oid("cardtext") });
}

// ---------------------------------------------------------------- slides

// 1. Title
pres.addSection({ title: "Introduction" });
let s = pres.addSlide({ masterName: "MK_TITLE", sectionTitle: "Introduction" });
s.addImage({ path: img("welcome"), x: 4.6, y: 0, w: 5.4, h: 5.625, sizing: { type: "cover", w: 5.4, h: 5.625 }, objectName: "hero" });
s.addText("MK WORKSTATION", { x: 0.6, y: 1.0, w: 4, h: 0.3, fontSize: 12, bold: true, color: C.accent2, charSpacing: 3, isTextBox: true, margin: 0 });
s.addText("Fedora, finished", { placeholder: "title" });
s.addText("One command turns a fresh Fedora Workstation into a fast, good-looking desktop that already works the way you do.", { placeholder: "body" });
s.addText("Free and open source · Fedora 44 · GNOME 50", { x: 0.6, y: 4.75, w: 4.2, h: 0.3, fontSize: 11, color: C.background2, isTextBox: true, margin: 0 });
s.addNotes("MK Workstation is a set of scripts and small apps that set up Fedora Workstation in one go: settings, extensions, apps, codecs, shortcuts. The rest of this deck walks through what you get.");

// 2. Why
s = content("Introduction", "Why it exists", "Great foundation, bare walls");
s.addText("Fedora is one of the best Linux systems you can install. Out of the box it's a blank canvas: few apps, missing video codecs, and a desktop that works differently from the one you came from.",
  { x: 0.5, y: 1.4, w: 4.3, h: 1.5, fontSize: 16, color: C.text2, valign: "top", margin: 0, isTextBox: true });
row(s, "edit-undo", "Before", "a weekend of forum posts, extensions and settings", 0.5, 3.05, 4.3);
row(s, "software-update-available", "After", "one command, a coffee, a finished desktop", 0.5, 3.95, 4.3);
[["1", "command sets up\nthe whole desktop"], ["~15 min", "from fresh install\nto finished"], ["0", "settings you need\nto look up"], ["100%", "open source, scripts\nyou can read"]]
  .forEach(([big, small], i) => {
    const x = 5.3 + (i % 2) * 2.15, y = 1.4 + Math.floor(i / 2) * 1.75;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 2.0, h: 1.55, rectRadius: 0.12, fill: { color: C.background2 }, line: { type: "none" }, objectName: oid("stat") });
    s.addText(big, { x: x + 0.2, y: y + 0.15, w: 1.7, h: 0.7, fontSize: 36, bold: true, color: C.accent1, margin: 0, isTextBox: true, objectName: oid("statbig") });
    s.addText(small, { x: x + 0.2, y: y + 0.85, w: 1.7, h: 0.6, fontSize: 12, color: C.text2, margin: 0, isTextBox: true, valign: "top", objectName: oid("statsmall") });
  });

// 3. Switching
pres.addSection({ title: "Your desktop" });
s = content("Your desktop", "Moving between apps", "Swipe through your windows");
shot(s, "alttab", 0.5, 1.4, 5.6, 3.15);
caption(s, "One glowing ring glides to the window you want", 0.5, 4.65, 5.6);
row(s, "input-touchpad", "Three fingers", "every window, every workspace", 6.4, 1.45, 3.1);
row(s, "view-grid", "Four fingers", "workspaces; up for an overview", 6.4, 2.3, 3.1);
row(s, "system-run", "As fast as GNOME", "measured, frame for frame", 6.4, 3.15, 3.1);
row(s, "view-reveal", "Steady", "same finger travel per window", 6.4, 4.0, 3.1);
s.addNotes("Alt+Tab and the three-finger swipe show one switcher with a ring that follows your fingers. Each window takes the same finger travel however many are open, so fast swipes land where you expect.");

// 4. Windows
s = content("Your desktop", "Windows that behave", "Snap, tile, focus. No dragging.");
shot(s, "tiled", 0.5, 1.4, 5.6, 3.15);
caption(s, "Halves and quarters with Super and the arrow keys", 0.5, 4.65, 5.6);
row(s, "view-dual", "Snap layouts", "Super+Z, pick one, the rest fill in", 6.4, 1.45, 3.1);
row(s, "window-new", "Snap Assist", "offers your other windows for the space", 6.4, 2.3, 3.1);
row(s, "view-pin", "Always on top", "Super+Ctrl+T for a video or a calculator", 6.4, 3.15, 3.1);
row(s, "view-grid", "New desktop", "Super+Ctrl+D, Shift takes the window", 6.4, 4.0, 3.1);

// 5. Welcome
s = content("Your desktop", "After you log in", "A desktop that says hello, and remembers");
shot(s, "welcome", 0.5, 1.4, 5.6, 3.15);
caption(s, "The greeting lands with the light, your tasks underneath", 0.5, 4.65, 5.6);
row(s, "weather-clear-night", "Light on time", "plays once the desktop is ready", 6.4, 1.45, 3.1);
row(s, "view-pin", "What's waiting", "pinned tasks and today's next reminder", 6.4, 2.3, 3.1);
row(s, "face-smile", "Your way", "your name or your own line, spoken if you like", 6.4, 3.15, 3.1);
row(s, "preferences-color", "Your colours", "taken from your wallpaper", 6.4, 4.0, 3.1);

// 6. MK Notes
pres.addSection({ title: "MK Notes" });
s = content("MK Notes", "Super + N", "MK Notes: write, link, draw, find");
shot(s, "notes-split", 0.5, 1.4, 5.2, 2.925);
s.addImage({ path: img("phone-note"), x: 5.95, y: 1.4, w: 1.45, h: 2.93, objectName: "phone",
  shadow: { type: "outer", color: "0B1430", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
caption(s, "Live preview on the laptop, the same notes on your phone", 0.5, 4.45, 6.9);
row(s, "x-office-document", "Your files", "plain Markdown you own", 7.6, 1.45, 2.0);
row(s, "network-workgroup", "Linked", "links, backlinks, graph", 7.6, 2.25, 2.0);
row(s, "applications-graphics", "Drawn", "pen with pressure", 7.6, 3.05, 2.0);
row(s, "edit-paste", "Pasted", "screenshots straight in", 7.6, 3.85, 2.0);

// 7. MK Notes, more
s = content("MK Notes", "MK Notes", "The features you'd normally pay for");
[["emblem-system", "Phone sync", "browser or Android, offline, over Wi-Fi"],
 ["x-office-document", "PDF export", "one click, with pictures"],
 ["network-workgroup", "Your website", "publish notes as web pages"],
 ["document-open-recent", "Version history", "how a note looked this morning"],
 ["x-office-calendar", "Daily notes", "a calendar of the days you wrote"],
 ["checkbox-checked", "Tasks view", "every checkbox, in one list"],
 ["view-reveal", "Focus mode", "F11: nothing but the words"],
 ["preferences-color", "Your look", "theme, font, size, spacing"]]
  .forEach(([ic, h, b], i) => card(s, ic, h, b, 0.5 + (i % 4) * 2.28, 1.4 + Math.floor(i / 4) * 1.85, 2.1, 1.7));

// 8. Focus
pres.addSection({ title: "Focus and tools" });
s = content("Focus and tools", "Focus timer", "Step away. It notices.");
shot(s, "saver-bubbles", 0.5, 1.4, 4.4, 2.475);
shot(s, "saver-starfield", 5.1, 1.4, 4.4, 2.475);
caption(s, "Bubbles or a starfield over your work; any touch and you're back", 0.5, 3.95, 9);
row(s, "alarm", "Counts down in the top bar", "the window gets out of your way", 0.5, 4.35, 4.4);
row(s, "face-smile", "A celebration, not an alarm", "a little party when time's up", 5.1, 4.35, 4.4);

// 9. Top bar
s = content("Focus and tools", "The top bar", "Everything you check, one click away");
s.addImage({ path: img("monitor"), x: 0.5, y: 1.4, w: 2.9, h: 2.6, objectName: "monitor",
  shadow: { type: "outer", color: "0B1430", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
s.addImage({ path: img("quick"), x: 3.6, y: 1.4, w: 2.27, h: 2.6, objectName: "quick",
  shadow: { type: "outer", color: "0B1430", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
caption(s, "System monitor and Quick Settings", 0.5, 4.1, 5.4);
row(s, "video-display", "System monitor", "CPU, memory, temperatures, battery draw", 6.2, 1.45, 3.3);
row(s, "edit-paste", "Clipboard history", "Super+V brings back what you copied", 6.2, 2.3, 3.3);
row(s, "weather-clear-night", "Keep awake", "one switch for films and downloads", 6.2, 3.15, 3.3);
row(s, "view-grid", "Tray icons", "chat apps and launchers, like anywhere", 6.2, 4.0, 3.3);

// 10. Apps
s = content("Focus and tools", "Apps", "Installed and ready on first login");
[["app.zen_browser.zen", "Zen Browser"], ["net.cozic.joplin_desktop", "Joplin"], ["org.onlyoffice.desktopeditors", "ONLYOFFICE"],
 ["vscode", "VS Code"], ["com.spotify.Client", "Spotify"], ["net.lutris.Lutris", "Lutris"], ["com.mattjakeman.ExtensionManager", "Extensions"],
 ["net.sonobus.SonoBus", "SonoBus"], ["com.github.tenderowl.frog", "Frog"], ["one.alynx.FlipClock", "FlipClock"],
 ["io.github.mehulk.MkNotes", "MK Notes"], ["io.github.mehulk.MkCompanion", "Companion"], ["io.github.mehulk.MkTimer", "Focus Timer"],
 ["io.github.mehulk.MkShortcuts", "Shortcuts"]]
  .forEach(([id, label], i) => {
    const x = 0.5 + (i % 7) * 1.3, y = 1.45 + Math.floor(i / 7) * 1.45;
    s.addImage({ path: app(id), x: x + 0.3, y, w: 0.7, h: 0.7, objectName: oid("app") });
    s.addText(label, { x, y: y + 0.78, w: 1.3, h: 0.3, fontSize: 12, align: "center", color: C.text1,
      bold: id.startsWith("io.github.mehulk"), margin: 0, isTextBox: true, objectName: oid("applabel") });
  });
s.addText("Plus video and audio codecs, hardware video decoding, a modern terminal toolkit, gaming helpers and developer tools. Every app list is a plain text file: add a line and it's yours. Bold ones are made for MK Workstation.",
  { x: 0.5, y: 4.4, w: 9, h: 0.7, fontSize: 13, color: C.text2, valign: "top", margin: 0, isTextBox: true });

// 11. Hardware
pres.addSection({ title: "Your computer" });
s = content("Your computer", "Your computer", "It looks at your hardware, then tunes for it");
[["auth-fingerprint", "Fingerprint and face", "log in with a touch or a glance"],
 ["battery-full", "Battery that lasts", "fast on power, gentle on battery"],
 ["audio-speakers", "Speakers with body", "warmth, real bass, clearer voices"],
 ["input-tablet", "Touch and 2-in-1s", "rotation, tablet mode, pen"],
 ["video-display", "Right graphics driver", "hardware video for Intel, AMD, NVIDIA"],
 ["system-run", "Older machines too", "mk effects lite keeps it smooth"]]
  .forEach(([ic, h, b], i) => card(s, ic, h, b, 0.5 + (i % 3) * 3.05, 1.4 + Math.floor(i / 3) * 1.85, 2.9, 1.7));

// 12. Shortcuts
s = content("Your computer", "Keyboard", "Your hands already know these");
const keys = [["Super+E", "Files"], ["Super+N", "MK Notes"], ["Super+B", "Web browser"], ["Super+V", "Clipboard history"],
  ["Super+Shift+S", "Screenshot an area"], ["Super+Z", "Snap layouts"], ["Ctrl+Shift+Esc", "System Monitor"],
  ["Super+L", "Lock"], ["Ctrl+Alt+End", "Shut down"], ["Ctrl+Alt+Home", "Restart"]];
keys.forEach(([k, v], i) => {
  const x = 0.5 + (i % 2) * 2.7, y = 1.45 + Math.floor(i / 2) * 0.68;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 1.45, h: 0.4, rectRadius: 0.08, fill: { color: C.background2 }, line: { type: "none" }, objectName: oid("key") });
  s.addText(k, { x, y, w: 1.45, h: 0.4, fontSize: 12, bold: true, color: C.accent1, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: oid("keytext") });
  s.addText(v, { x: x + 1.55, y, w: 1.1, h: 0.4, fontSize: 12, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: oid("keylabel") });
});
s.addImage({ path: img("shortcuts"), x: 6.0, y: 1.4, w: 3.45, h: 3.48, objectName: "shortcuts",
  shadow: { type: "outer", color: "0B1430", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
caption(s, "Super+/ shows every shortcut, live, and lets you change any key", 6.0, 4.92, 3.5);

// 13. Safe
s = content("Your computer", "No risk", "Try it, change your mind, nothing breaks");
row(s, "document-open-recent", "A snapshot every time", "mk restore puts your settings back", 0.5, 1.45, 5.3);
row(s, "user-trash", "One-line uninstall", "mk uninstall removes MK's tools", 0.5, 2.2, 5.3);
row(s, "checkbox-checked", "Health check", "mk doctor finds problems and says how to fix them", 0.5, 2.95, 5.3);
row(s, "x-office-document", "Readable", "plain shell and Python, every change in git", 0.5, 3.7, 5.3);
row(s, "software-update-available", "One update", "mk update does system, apps and settings", 0.5, 4.45, 5.3);
s.addImage({ path: img("companion"), x: 6.6, y: 1.35, w: 2.55, h: 3.47, objectName: "companion",
  shadow: { type: "outer", color: "0B1430", opacity: 0.18, blur: 10, offset: 3, angle: 90 } });
caption(s, "The Companion: quick notes, tasks, reminders", 6.3, 4.88, 3.2);

// 14. Get started
pres.addSection({ title: "Get started" });
s = pres.addSlide({ masterName: "MK_DARK", sectionTitle: "Get started" });
s.addText("GET STARTED", { placeholder: "kicker" });
s.addText("Get it in three commands", { placeholder: "title" });
["git clone " + GITHUB + ".git", "cd fedora-workstation-config", "sudo ./setup.sh"].forEach((cmd, i) => {
  const y = 1.85 + i * 0.72;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y, w: 8.8, h: 0.56, rectRadius: 0.1, fill: { color: C.text2, transparency: 55 }, line: { type: "none" }, objectName: oid("cmdbox") });
  s.addText([{ text: `${i + 1}   `, options: { bold: true, color: C.accent2 } }, { text: cmd, options: { color: C.background1, fontFace: "Courier New" } }],
    { x: 0.8, y, w: 8.4, h: 0.56, fontSize: 12, valign: "middle", margin: 0, isTextBox: true, objectName: oid("cmd") });
});
s.addText("On a fresh Fedora Workstation. Then log out and back in. That's it.", { x: 0.6, y: 4.1, w: 8.8, h: 0.35, fontSize: 16, color: C.background2, isTextBox: true, margin: 0 });
s.addText([
  { text: "Source code and issues", options: { hyperlink: { url: GITHUB }, color: C.accent2, bold: true } },
  { text: "      " },
  { text: "Getting started guide", options: { hyperlink: { url: GITHUB + "/blob/main/docs/GUIDE.md" }, color: C.accent2, bold: true } },
  { text: "      " },
  { text: "Every feature", options: { hyperlink: { url: GITHUB + "/blob/main/docs/FEATURES.md" }, color: C.accent2, bold: true } },
], { x: 0.6, y: 4.65, w: 8.8, h: 0.35, fontSize: 14, isTextBox: true, margin: 0 });

// pptxgenjs can't write theme colours; build-deck.sh writes THEME (saved
// next to the deck as JSON) into the theme part afterwards.
(async () => {
  await pres.writeFile({ fileName: OUT });
  require("fs").writeFileSync(OUT + ".theme.json", JSON.stringify(THEME));
  console.log("wrote " + OUT);
})();

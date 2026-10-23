# Third-party components

MK Workstation's own code is under the [MIT License](LICENSE). The repository bundles one third-party component, kept only because extensions.gnome.org has no GNOME 50 build of it; `sync.sh` installs every other extension straight from [extensions.gnome.org](https://extensions.gnome.org/), where its authors publish it under their own licenses.

| Component | Path | License | Upstream | Changes |
| :--- | :--- | :--- | :--- | :--- |
| WACK Shell 1.0.0 | `extensions/wack-shell@rinzler69-wastaken.github.com/` | GPL-3.0 (see its `LICENSE`) | <https://github.com/rinzler69-wastaken/wack-shell> | `panelComponents.js`: `return super.vfunc_event(event);` replaced with `return Clutter.EVENT_PROPAGATE;` in two places, because GNOME 50 no longer provides `StWidget.vfunc_event` (marked `// MK:`). |

Software installed by `setup.sh` (Fedora packages, RPM Fusion, Flathub apps, Howdy from the `principis/howdy` COPR, Microsoft's VS Code repository) is downloaded from its publishers and is not redistributed here.

## Images

The screenshots in `docs/assets/screens/` and `docs/MK-Workstation-Overview.pdf` show Fedora 44's default wallpaper (`f44-backgrounds`, by the Fedora Design Team, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). The screenshots themselves are part of this project's documentation under its MIT License; the wallpaper visible in them stays under CC BY-SA 4.0. App icons shown in them belong to their projects.

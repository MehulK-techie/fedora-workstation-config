# Releasing and sharing

For the maintainer: how to cut a release and where to tell people about it.

## Before a release

```bash
just check                         # ShellCheck + Python syntax (same as CI)
mk doctor                          # on your own machine
python3 docs/overview/build.py     # PDF matches the current features
git status                         # nothing left uncommitted
```

Then test a clean install once, ideally in a virtual machine: GNOME Boxes
with the Fedora Workstation ISO, `git clone`, `sudo ./setup.sh`, log out and
in, `mk doctor`. This catches anything that only works on your own laptop.

## Cut the release

1. **Push the branch** (your GitHub token needs the `workflow` scope because
   the repo contains a GitHub Actions file):
   ```bash
   git push -u origin fix/dbus-pam-dnf
   ```
2. **Open a pull request** into `main`, let the ShellCheck action pass, merge.
3. **Date the changelog**: change `## 2.0.0 (unreleased, ...)` to
   `## 2.0.0 (YYYY-MM-DD)` on `main` and commit.
4. **Tag it**:
   ```bash
   git checkout main && git pull
   git tag -a v2.0.0 -m "MK Workstation 2.0.0"
   git push origin v2.0.0
   ```
5. **Create a GitHub release** from the tag, paste the 2.0.0 section of the
   changelog, and attach `docs/MK-Workstation-Overview.pdf`:
   ```bash
   gh release create v2.0.0 docs/MK-Workstation-Overview.pdf \
     --title "MK Workstation 2.0.0" --notes-file <(sed -n '/^## 2.0.0/,/^## 1.0.0/p' CHANGELOG.md | head -n -1)
   ```

## Make the GitHub page inviting

- **About:** a one-line description, the website field pointing at the PDF,
  and topics such as `fedora`, `gnome`, `gnome-shell-extension`, `dotfiles`,
  `linux-setup`, `productivity`.
- **Social preview** (Settings › General): `docs/assets/screens/overview.jpg`,
  so links shared in chats show a picture.
- **Security** (Settings › Security): turn on private vulnerability reporting,
  which SECURITY.md points to.
- **Discussions** (optional): a place for questions that aren't bugs.

## Where to share it

| Where | What to post | Notes |
| :--- | :--- | :--- |
| [Fedora Discussion](https://discussion.fedoraproject.org/) › Project Discussion | A short introduction: what it does, screenshots, the PDF, the install commands | The Fedora community forum; be clear it's a personal project, not official Fedora |
| [Fedora Magazine](https://fedoramagazine.org/join-magazine-team) | A **pitch**: a new topic in the Magazine category of Fedora Discussion with a summary, the audience and an outline | The closest thing to Fedora "approving" it: editors review pitches at their weekly meeting, then help you write and schedule the article. Read [Proposing Articles](https://docs.fedoraproject.org/en-US/fedora-magazine/writing-a-pitch/) first |
| r/Fedora, r/gnome | Screenshots and the repo link | Follow each subreddit's self-promotion rules |
| r/unixporn | A desktop screenshot with the `[GNOME]` tag and details in a comment | Show the look; the repo goes in the comment |

**Be upfront about AI help.** This project was built with an AI assistant
(see the `Co-Authored-By` lines in the history). Fedora has an AI-assisted
contributions policy that applies to things like Magazine articles; say so in
pitches and posts.

## Keeping it healthy

- Answer issues with the output of `mk device` and `mk doctor` in mind; the
  issue templates ask for them.
- When GNOME updates (every six months), run `just check`, re-test the
  headless shell steps in [ARCHITECTURE.md](ARCHITECTURE.md), and check that
  every extension still has a build on extensions.gnome.org.
- Add tested machines to [HARDWARE.md](HARDWARE.md) as people report them.

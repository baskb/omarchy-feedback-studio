# Feedback Studio for Omarchy

[Feedback Studio](https://github.com/baskb/feedback-studio) overlays a local
website you're building, or a Markdown file you're writing, so you can click
any element, select any sentence, and say what should change, typed or spoken,
from your desk or from your phone. Your coding agent then applies the comments
when you say **PPF** (Please Process Feedback).

This plugin puts it in the **Omarchy bar**:

- **One icon, one number.** The icon lights up while a review server runs and
  shows how many comments are still open.
- **Every session at a glance.** Label or project, open / resolved / total
  counts, mode (static site, dev server, Markdown, demo), port, and what the
  coding agent is doing right now ("Claude is on a comment · editing src/Header.jsx").
- **Review from your phone.** One click shows a QR code for the session's
  phone URL. Scan it, tap an element, speak.
- **New-comment notifications.** A comment arriving from your phone becomes a
  desktop notification; click it to open the session.
- **Start a review without a terminal.** Open a project folder or a `.md` file
  through a picker, or try the bundled demo. The server's banner with the
  phone URL stays visible in its own terminal window; Ctrl+C ends the session.
- **Keyboard first**, like the rest of the Omarchy shell: `Super+Shift+F` (see
  below), then arrows, Enter to open, `Q` for the QR code, `D` demo, `O` picker, `R` refresh.

## Requirements

- **Omarchy 4.0 or newer.** Shell plugins arrived in 4.0 "Quattro".
- **Node.js 18 or newer.** Omarchy does not install it; mise does, in one line:

  ```
  mise use -g node@lts
  ```

  The widget tells you when Node is missing. Feedback Studio itself is fetched
  from npm on first use (`npx -y feedback-studio@1`) and needs **1.0.1 or
  newer**, the first release that registers its sessions for this widget.
- `jq`, `curl`, `gum`, and `qrencode` ship with Omarchy.

## Install

```
omarchy plugin add https://github.com/baskb/omarchy-feedback-studio --enable
```

Or from the Omarchy menu: **Setup → Plugins → Add Plugin**, paste the URL, then
**Enable Plugin**. The widget lands in the right section of the bar; move it with

```
omarchy bar move baskb.feedback-studio --section right
```

### Hotkey

Add to `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + SHIFT + F", "Feedback Studio", "omarchy-shell shell toggle baskb.feedback-studio")
```

### Menu entries (optional)

Add to `~/.config/omarchy/extensions/omarchy-menu.jsonc`:

```jsonc
"feedback": {"icon":"󰍩","label":"Feedback Studio","aliases":["feedback","review","ppf"]},
"feedback.panel": {"icon":"󰍩","label":"Sessions","action":"omarchy-shell shell toggle baskb.feedback-studio"},
"feedback.pick": {"icon":"󰝰","label":"Review a folder or .md","action":"bash ~/.config/omarchy/plugins/baskb.feedback-studio/bin/fbs-launch pick"},
"feedback.demo": {"icon":"󰐊","label":"Try the demo","action":"bash ~/.config/omarchy/plugins/baskb.feedback-studio/bin/fbs-launch demo"},
```

## Using it

| Where | Action |
|---|---|
| Bar icon, left click | Open the panel |
| Bar icon, middle click | Open the newest session in the browser |
| Bar icon, right click | Refresh |
| Session row, click or Enter | Open that session in the browser |
| 󰐲 on a row, or `Q` | Show a QR code for the session's phone URL (greyed out when the session is local only) |
| 󰏌 on a row | Open in the browser |
| 󰓛 on a row | Stop the session. Comments stay in the project's `.feedback/` folder |
| **Open a folder or .md**, or `O` | A terminal opens with a picker. Choose a project folder (a `dist/`, `build/`, `out/`… inside it is auto-detected; a folder of Markdown becomes a document review) or one `.md` file |
| **Demo**, or `D` | The bundled sample page, in a throwaway copy |
| **Docs** | The Feedback Studio README |
| `omarchy-shell shell status baskb.feedback-studio` | Summary line for scripts (`refresh`, `demo`, and `pick` exist too) |

Sessions you start elsewhere, from a terminal or from the Claude Code plugin's
`/feedback-studio:feedback start`, show up here too. The widget reads the
registry Feedback Studio keeps in `~/.feedback-studio/sessions/` and asks each
server for its counts over its local API.

### Phone review

A QR code needs a URL your phone can reach. Sessions started from the widget
with **Phone-ready sessions** turned on use `--tunnel`: a public HTTPS URL
through a Cloudflare quick tunnel, with a real certificate, so the phone
microphone works on any network. Traffic then leaves your machine, through
Cloudflare, and anyone with the link can view the page; read the
[notes on tunnels and share links](https://github.com/baskb/feedback-studio#notes--limits)
before reviewing sensitive content. On your own LAN, `--host 0.0.0.0` with
`--https` works as well; the widget shows a QR for either.

## Settings

Widget settings live in `~/.config/omarchy/shell.json` on the widget's entry
(`omarchy plugin` and the bar's settings form write them for you):

| Key | Default | Meaning |
|---|---|---|
| `refreshIntervalSec` | `5` | Poll interval while the panel is closed. Open, it polls every 2 s. |
| `notifyNewComments` | `true` | Desktop notification when a session gains a comment. |
| `useTunnel` | `false` | Start sessions from the widget with `--tunnel`. |
| `serverCommand` | `""` | Command that runs Feedback Studio. Empty means `npx -y feedback-studio@1`. Point it at a clone to run a development build. |
| `pickRoot` | `""` | Folder the picker starts in. Empty means your home folder. |

## How it works

The plugin is deliberately thin. Its QML (`Widget.qml`, `Service.qml`) only
draws and schedules; three small Bash scripts in `bin/` do the work:

- `fbs-sessions` lists live servers from `~/.feedback-studio/sessions/*.json`,
  sweeps entries whose process is gone, and asks each server's API for comment
  counts and agent presence. It identifies itself as *not* the agent, so polling
  never shows up as "agent online" on the page.
- `fbs-qr` turns a URL into a 0/1 matrix with `qrencode`, the same way the
  shell's own Wi-Fi share card does.
- `fbs-launch` opens a terminal and runs Feedback Studio there, after checking
  for Node.

Nothing here installs packages, runs as root, or phones home. The only network
traffic the widget itself makes is to `127.0.0.1`.

## Update and remove

```
omarchy plugin update baskb.feedback-studio
omarchy plugin remove baskb.feedback-studio
```

Feedback Studio itself updates through npm: `npx -y feedback-studio@1` always
runs the newest 1.x.

## Development

Clone the repo and point Omarchy at the checkout, then edit; the shell reloads
plugin code on save:

```
git clone https://github.com/baskb/omarchy-feedback-studio ~/src/omarchy-feedback-studio
ln -s ~/src/omarchy-feedback-studio ~/.config/omarchy/plugins/baskb.feedback-studio
omarchy-shell shell rescanPlugins
omarchy plugin enable baskb.feedback-studio right
qs -p /usr/share/omarchy/shell log -t 50 | grep -i feedback     # QML errors, if any
node --test test/*.test.mjs                                      # Model.js unit tests
omarchy plugin validate .
```

To run the widget against a Feedback Studio clone instead of npm, set the
`serverCommand` setting to
`node /path/to/feedback-studio/plugins/feedback-studio/bin/feedback-studio.mjs`.

## License

MIT. Feedback Studio is a separate project under the same license; see
`LICENSE` for the tools this plugin runs.

# Third-party software

This plugin bundles no third-party code. It runs the programs below, which
are installed separately and keep their own licenses.

| Software | License | Used for | Comes from |
|---|---|---|---|
| [feedback-studio](https://github.com/baskb/feedback-studio) | MIT | The review server the widget shows | npm, fetched by `npx -y feedback-studio@1` on first use. Its own optional helpers (marked, selfsigned, cloudflared, html-to-image) are listed in that project's `THIRD-PARTY.md`. |
| Node.js | MIT | Runs Feedback Studio | `mise use -g node@lts` |
| qrencode | LGPL-2.1 | The phone QR code | Omarchy |
| jq | MIT | Reading the session registry and API replies | Omarchy |
| curl | curl license (MIT-style) | Talking to the local review server | Omarchy |
| gum | MIT | The folder picker and comment prompt in a terminal | Omarchy |
| grim, slurp | MIT | Screenshot comments | Omarchy |
| ImageMagick | ImageMagick License | Shrinking a screenshot that is too large | Omarchy |
| wl-clipboard (`wl-copy`) | GPL-3.0 | Copying the report | Omarchy |
| mise | MIT | Installing Node.js | Omarchy |
| Tailscale (optional) | BSD-3-Clause | Phone access over your tailnet | Installed by you |
| Claude Code (optional) | Anthropic's terms | The hand-off buttons | Installed by you |

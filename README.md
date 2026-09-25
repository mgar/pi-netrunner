# pi-netrunner

Netrunner flavor for the [pi coding agent](https://pi.dev). While pi works, the plain "Working..." loader turns into a Night City terminal. It takes its colors from your pi theme, so it fits whatever palette you use.

![pi-netrunner: glitch banner, tool-aware loader and NetWatch trace](https://raw.githubusercontent.com/mgar/pi-netrunner/main/docs/demo.gif)

## What it changes

- **Loader lines:** about 50 netrunner-themed phrases, swapped every 2.5 seconds and never repeated back to back.
- **Tool-aware lines:** while a tool runs, the line says what it's doing: `Uploading quickhack: git status`, `Scanning shard: README.md`, `Rewriting ICE: app.ts`, `Pinging the subnet for "TODO"`, `Jacking into example.com`.
- **Decrypt reveal:** each new line starts as scrambled characters and resolves left to right.
- **Glitch flashes:** every few seconds the line flickers into a corrupted version in your theme's error color.
- **Spinner:** seven netrunner styles to choose from (see [Spinners](#spinners)). The default is a flickering random braille cell.
- **NetWatch trace:** after 10 seconds a `TRACE` meter appears and climbs to 100% over two minutes, blinks `TRACE COMPLETE`, then restarts.
- **Run outcome:** when pi finishes, the footer shows `◆ Breach successful`, `◆ Jacked out` (aborted) or `◆ Flatlined` (error), with the run time, for six seconds.
- **Startup banner:** a NETRUNNER logo in yellow block letters with a cyan shadow, glitch streaks and red fading edges, after the game's logo, framed by signal noise and a torn scanline. It replaces pi's default header, which includes its keybinding hints. Terminals narrower than 80 columns get a compact version.
- **Hidden thinking blocks:** labelled "Netrunning...".
- **`netrunner` theme:** an optional neon pi theme, for the full Night City look.

Everything except the theme affects only pi's interactive terminal UI. RPC, JSON and print modes are untouched.

## Install

```bash
pi install npm:pi-netrunner
```

Or try it for one session without installing:

```bash
pi -e npm:pi-netrunner
```

Tested with pi 0.87.1.

To use the matching theme, open `/settings`, choose **Theme**, and select `netrunner`. See [The `netrunner` theme](#the-netrunner-theme) for the recommended terminal colors.

## Usage

| Command                     | Effect                                                          |
|-----------------------------|-----------------------------------------------------------------|
| `/netrunner`                | Open the settings menu                                          |
| `/netrunner spinner`        | Pick a spinner style                                            |
| `/netrunner spinner <name>` | Set a spinner style directly, e.g. `/netrunner spinner scanner` |
| `/netrunner colors`         | Pick theme or neon colors                                       |
| `/netrunner colors <name>`  | Set colors directly: `theme` or `neon`                          |
| `/netrunner off`            | Restore pi's default loader, spinner, header and thinking label |
| `/netrunner on`             | Turn it back on                                                 |

The on/off toggle lasts for the current pi process. To turn the extension off permanently, disable it with `pi config` or run `pi remove npm:pi-netrunner`.

Tool commands and paths are shown only in your local terminal. Terminal escape sequences and control characters are stripped before display.

## Spinners

| Name      | Frames  | Style                |
|-----------|---------|----------------------|
| `noise`   | `⢔⡱⣏`   | Data noise (default) |
| `neon`    | `▖▘▝▗`  | Neon blocks          |
| `uplink`  | `▁▃▅▇`  | Uplink bars          |
| `scanner` | `▱▰▰▱▱` | Scanner sweep        |
| `shade`   | `░▒▓█`  | Glitch shade         |
| `flicker` | `▚▞`    | Diagonal flicker     |
| `optic`   | `◐◓◑◒`  | Kiroshi optic        |

Your spinner and color choices are saved to `~/.pi/agent/netrunner.json` (or the `netrunner.json` in your custom pi agent directory) and apply to every session:

```json
{
  "spinner": "scanner",
  "colors": "neon"
}
```

You can also edit that file by hand and run `/reload`. Unknown values fall back to the defaults: `noise` and `theme`.

## Colors

There are two color modes, set with `/netrunner colors`:

- **`theme`** (default) uses your active pi theme, so it matches any palette.
- **`neon`** uses the colors from the game's logo, yellow `#fcee0a` and cyan `#52bedc`, plus red `#ff003c` for alerts. Only the netrunner elements change; the rest of pi keeps your theme. Use this when your theme's yellow and cyan are too muted for the logo.

In `theme` mode, the scheme is still built on yellow and cyan like the game's logo, in your theme's own shades:

| Element                                       | Theme color                                                  |
|-----------------------------------------------|--------------------------------------------------------------|
| Banner logo                                   | `warning` (yellow)                                           |
| Banner shadow, subtitle, tagline, loader text | cyan (see below)                                             |
| Decrypt scramble, trace label                 | `dim`                                                        |
| Glitch flash, banner fades, scanline tear, status tag | `error`                                              |
| Spinner                                       | cyan, `warning`, `error`, `syntaxKeyword` depending on style |
| Trace percentage                              | `success`, then `warning`, then `error` as it climbs         |
| Run outcome                                   | `success` / `warning` / `error`                              |
| Thinking label                                | `thinkingText`                                               |

Themes don't have a "cyan" color, so the extension checks `borderAccent`, `accent`, `thinkingLow`, `syntaxType`, `mdLink`, `mdCode`, `syntaxVariable` and `border`, and uses the one whose hue is closest to cyan. Grays are skipped. In pi's built-in dark theme, for example, that's `borderAccent` (`#00d7ff`).

In `neon` mode, yellow, cyan and red (`error` and `syntaxKeyword`) come from the game's palette. `dim`, `success` and `thinkingText` still come from your theme. In terminals limited to 256 colors, neon colors use the nearest palette match.

### The `netrunner` theme

For the full neon look across all of pi, select the bundled `netrunner` theme in `/settings`. It uses the same yellow, cyan and red as `neon` mode, so the banner and effects look identical in either color mode.

A pi theme can color text and pi's own panels, but not your terminal's background. To work on any dark terminal, the theme leaves message and pending-tool panels on the terminal's default background, and only tints selections and finished tool output (green for success, red for errors).

The theme is designed for a near-black terminal. On a gray or colored background it still works, but the neon colors lose some punch. For the intended look, set these colors in your terminal's profile:

| Setting    | Color     |
|------------|-----------|
| Background | `#0b0c0f` |
| Foreground | `#e5e5e5` |
| Cursor     | `#52bedc` |
| Selection  | `#1f3a44` |

For example, add `background = #0b0c0f` to your Ghostty config, or in iTerm2 open **Settings → Profiles → Colors** and set **Background**. Terminal settings apply to everything you run in that profile, not only pi.

## Development

```bash
npm install
npm test
npm run check
```

The tests use Node's built-in test runner and run the TypeScript extension directly, so there's no build step. They need Node 22.19 or later, the same as pi. They load the extension against a fake pi runtime with real pi themes and fake timers, and cover tool-line sanitizing, settings persistence, color picking and on/off behavior.

Node strips TypeScript types without checking them, so `npm run check` type-checks the extension with `tsc`. It also rejects TypeScript-only syntax that Node can't run directly, such as `enum`.

To try local changes in pi, run `pi -e .` from the repository.

## Disclaimer

This is an unofficial fan project, not affiliated with or endorsed by CD PROJEKT RED. Cyberpunk and Cyberpunk 2077 are trademarks of CD PROJEKT S.A.

## License

[MIT](LICENSE)

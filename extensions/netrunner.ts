/**
 * pi-netrunner
 *
 * Netrunner flavor for pi's interactive UI:
 * - rotating Night City loader lines, tool-aware while tools run
 * - decrypt reveal and glitch flashes on the loader text
 * - a choice of seven spinners (saved to <agent-dir>/netrunner.json) and a NetWatch trace meter
 * - run outcome in the footer and a startup banner
 *
 * Colors come from the active pi theme by default, so it blends with any palette.
 * The "neon" colors setting uses the game's yellow and cyan instead; the bundled
 * `netrunner` theme gives the full neon look across all of pi.
 *
 * Command: /netrunner [on | off | spinner [name] | colors [theme|neon]]
 */

import fs from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";

// Theme roles used for each netrunner color. Yellow and cyan echo the game's logo;
// every theme supplies its own shade of them. "cyan" is resolved per theme (see cyanRole).
type Role = ThemeColor | "cyan";
const PRIMARY: Role = "cyan";
const HIGHLIGHT: Role = "warning";
const ALERT: Role = "error";
const EXTRA: Role = "syntaxKeyword";
const FAINT: Role = "dim";

// Themes have no "cyan" slot, so pick whichever of these is closest to cyan in hue.
const CYAN_CANDIDATES: ThemeColor[] = [
	"borderAccent",
	"accent",
	"thinkingLow",
	"syntaxType",
	"mdLink",
	"mdCode",
	"syntaxVariable",
	"border",
];
const CYAN_HUE = 190;

/** RGB of a theme foreground escape (truecolor or 256-color); undefined for terminal defaults. */
function rgbOf(ansi: string): [number, number, number] | undefined {
	let m = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
	if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
	m = ansi.match(/38;5;(\d+)/);
	const n = m ? Number(m[1]) : -1;
	if (n >= 232) return [0, 0, 0].map(() => 8 + (n - 232) * 10) as [number, number, number];
	if (n >= 16) {
		const level = [0, 95, 135, 175, 215, 255];
		return [36, 6, 1].map((d) => level[Math.floor((n - 16) / d) % 6]!) as [number, number, number];
	}
	return undefined;
}

function cyanRole(theme: Theme): ThemeColor {
	let best: ThemeColor = "accent";
	let bestDistance = Infinity;
	for (const role of CYAN_CANDIDATES) {
		const rgb = rgbOf(theme.getFgAnsi(role));
		if (!rgb) continue;
		const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
		const max = Math.max(r, g, b);
		const delta = max - Math.min(r, g, b);
		if (max === 0 || delta / max < 0.2) continue; // grays have no useful hue
		const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
		const hue = (sector * 60 + 360) % 360;
		const distance = Math.min(Math.abs(hue - CYAN_HUE), 360 - Math.abs(hue - CYAN_HUE));
		if (distance < bestDistance) {
			bestDistance = distance;
			best = role;
		}
	}
	return best;
}

// Neon palette: used instead of the theme's shades when the "colors" setting is "neon".
type Rgb = [number, number, number];
type Palette = "theme" | "neon";
const PALETTES: Record<Palette, string> = {
	theme: "Theme (match your pi theme)",
	neon: "Neon (the game's yellow and cyan)",
};
const PALETTE_NAMES = Object.keys(PALETTES) as Palette[];
const isPalette = (v: unknown): v is Palette => typeof v === "string" && Object.hasOwn(PALETTES, v);
const NEON: Partial<Record<Role, Rgb>> = {
	cyan: [55, 235, 243], // #37ebf3
	warning: [252, 238, 10], // #fcee0a
	error: [255, 0, 60], // #ff003c
	syntaxKeyword: [255, 0, 60],
};
let palette: Palette = "theme";

/**
 * Nearest xterm 256-color cube index, for terminals without truecolor. Rounds each channel
 * the way pi rounds theme colors, so neon and the netrunner theme match in 256-color mode.
 * (pi's grayscale fallback only applies to near-neutral colors, which neon doesn't use.)
 */
function to256(rgb: Rgb): number {
	const LEVELS = [0, 95, 135, 175, 215, 255];
	const nearest = (v: number) =>
		LEVELS.reduce((best, level, i) => (Math.abs(v - level) < Math.abs(v - LEVELS[best]!) ? i : best), 0);
	const [r, g, b] = rgb.map(nearest) as Rgb;
	return 16 + 36 * r + 6 * g + b;
}

function fg(theme: Theme, role: Role, text: string): string {
	const neon = palette === "neon" ? NEON[role] : undefined;
	if (neon) {
		const code = theme.getColorMode() === "truecolor" ? `38;2;${neon.join(";")}` : `38;5;${to256(neon)}`;
		return `\x1b[${code}m${text}\x1b[39m`;
	}
	return theme.fg(role === "cyan" ? cyanRole(theme) : role, text);
}

const PHRASES = [
	"Wake up, Samurai...",
	"Jacking in...",
	"Breaching protocol...",
	"Scanning with Kiroshi optics...",
	"Uploading quickhack...",
	"Decrypting Arasaka ICE...",
	"Pinging the local subnet...",
	"Reading the shard...",
	"Consulting Johnny Silverhand...",
	"Asking Delamain for a route...",
	"Waiting on a fixer callback...",
	"Cutting a deal at the Afterlife...",
	"Calibrating Sandevistan...",
	"Cooling cyberdeck RAM...",
	"Dodging NCPD scanners...",
	"Running a braindance...",
	"Getting Vik to check the chrome...",
	"Tuning into 89.7 Growl FM...",
	"Peeking past the Blackwall...",
	"Stabilizing the Relic...",
	"Cooking up something preem, choom...",
	"Nova. Almost there...",
	"Riding shotgun with Jackie...",
	"Getting a lift from Panam...",
	"Waiting for Judy to finish the BD edit...",
	"Drawing a card from Misty's tarot...",
	"Following Takemura's lead...",
	"Syncing with Alt Cunningham...",
	"Chatting with Brendan the vending machine...",
	"Taking a gig from Regina...",
	"Getting Mr. Hands on the line...",
	"Stalling Songbird...",
	"Ignoring Mr. Blue Eyes...",
	"Grabbing a Nicola on the corner...",
	"Ordering a drink at Lizzie's Bar...",
	"Taking the NCART to Watson...",
	"Crossing the Badlands...",
	"Chasing a lead in Dogtown...",
	"Taking the long way through Pacifica...",
	"Sneaking past the Tyger Claws...",
	"Overheating a Maelstrom ganger...",
	"Spinning up a ping daemon...",
	"Short-circuiting enemy cyberware...",
	"Sharpening the Mantis Blades...",
	"Polishing the Malorian 3516...",
	"Swapping cyberdecks at the ripperdoc...",
	"Backing up the engram...",
	"Keeping cyberpsychosis at bay...",
	"Wiring eddies to the fixer...",
	"Checking the Night City Wire...",
	"Scaling Arasaka Tower...",
];

const TICK_MS = 50;
const ROTATE_MS = 2500; // time each random line stays up
const TOOL_LINGER_MS = 1000; // keep a finished tool's line this long before rotating
const REVEAL_MS = 400; // decrypt reveal duration for a new line
const GLITCH_MS = 150;
const GLITCH_EVERY_MS = 8000; // average gap between glitch flashes
const TRACE_DELAY_MS = 10_000; // trace meter appears after this long
const TRACE_FULL_MS = 120_000; // 0% -> 100%
const TRACE_ALERT_MS = 3000; // "TRACE COMPLETE" blink, then the trace restarts
const OUTCOME_MS = 6000;
const MAX_TOOL_DETAIL = 48;

const SCRAMBLE = "01<>/\\|#%&$@ABCDEF";
const GLITCH = "░▒▓█▚▞";
const NOISE_FRAMES = 48; // pre-rolled random braille frames; enough that the loop isn't noticeable

const colored = (theme: Theme, glyphs: string[], roles: Role[]) =>
	glyphs.map((g, i) => fg(theme, roles[i % roles.length]!, g));

const SPINNERS = {
	noise: {
		label: "Data noise",
		sample: "⢔⡱⣏",
		build: (theme: Theme): WorkingIndicatorOptions => ({
			frames: colored(
				theme,
				Array.from({ length: NOISE_FRAMES }, () => String.fromCharCode(0x2800 + Math.floor(Math.random() * 256))),
				[PRIMARY, EXTRA, HIGHLIGHT],
			),
			intervalMs: 80,
		}),
	},
	neon: {
		label: "Neon blocks",
		sample: "▖▘▝▗",
		build: (theme: Theme) => ({
			frames: colored(theme, ["▖", "▘", "▝", "▗"], [HIGHLIGHT, PRIMARY, ALERT, PRIMARY]),
			intervalMs: 110,
		}),
	},
	uplink: {
		label: "Uplink bars",
		sample: "▁▃▅▇",
		build: (theme: Theme) => {
			const levels = "▁▂▃▄▅▆▇█";
			const frames = [..."▁▂▃▄▅▆▇█▇▆▅▄▃▂"].map((c) => {
				const level = levels.indexOf(c);
				return fg(theme, level < 3 ? PRIMARY : level < 6 ? HIGHLIGHT : ALERT, c);
			});
			return { frames, intervalMs: 70 };
		},
	},
	scanner: {
		label: "Scanner sweep",
		sample: "▱▰▰▱▱",
		build: (theme: Theme) => {
			const width = 5;
			const positions = [0, 1, 2, 3, 4, 3, 2, 1];
			const frames = positions.map((p) =>
				Array.from({ length: width }, (_, i) =>
					i === p ? fg(theme, PRIMARY, "▰") : Math.abs(i - p) === 1 ? fg(theme, ALERT, "▰") : fg(theme, FAINT, "▱"),
				).join(""),
			);
			return { frames, intervalMs: 90 };
		},
	},
	shade: {
		label: "Glitch shade",
		sample: "░▒▓█",
		build: (theme: Theme) => ({
			frames: colored(theme, ["░", "▒", "▓", "█", "▓", "▒"], [PRIMARY, PRIMARY, HIGHLIGHT, ALERT, HIGHLIGHT, PRIMARY]),
			intervalMs: 100,
		}),
	},
	flicker: {
		label: "Diagonal flicker",
		sample: "▚▞",
		build: (theme: Theme) => ({ frames: colored(theme, ["▚", "▞"], [PRIMARY, ALERT]), intervalMs: 140 }),
	},
	optic: {
		label: "Kiroshi optic",
		sample: "◐◓◑◒",
		build: (theme: Theme) => ({
			frames: colored(theme, ["◐", "◓", "◑", "◒"], [PRIMARY, HIGHLIGHT, PRIMARY, ALERT]),
			intervalMs: 120,
		}),
	},
} satisfies Record<string, { label: string; sample: string; build: (theme: Theme) => WorkingIndicatorOptions }>;

type SpinnerName = keyof typeof SPINNERS;
const SPINNER_NAMES = Object.keys(SPINNERS) as SpinnerName[];
const DEFAULT_SPINNER: SpinnerName = "noise";
const isSpinner = (v: unknown): v is SpinnerName => typeof v === "string" && Object.hasOwn(SPINNERS, v);

// --- Settings (<agent-dir>/netrunner.json) --------------------------------

const configPath = () => path.join(getAgentDir(), "netrunner.json");

function readConfig(): { data: Record<string, unknown>; error?: string } {
	try {
		const data: unknown = JSON.parse(fs.readFileSync(configPath(), "utf8"));
		if (data && typeof data === "object" && !Array.isArray(data)) return { data: data as Record<string, unknown> };
		return { data: {}, error: "expected a JSON object" };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { data: {} };
		return { data: {}, error: (err as Error).message };
	}
}

function writeConfig(patch: Record<string, unknown>): void {
	const { data, error } = readConfig();
	// Don't silently replace a file the user broke by hand.
	if (error) throw new Error(`${configPath()} is invalid (${error}); fix or delete it first`);
	fs.writeFileSync(configPath(), `${JSON.stringify({ ...data, ...patch }, null, 2)}\n`);
}

const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)]!;

function glitch(text: string): string {
	return [...text].map((c) => (c !== " " && Math.random() < 0.2 ? pick(GLITCH) : c)).join("");
}

/** Strip terminal escapes and control characters from untrusted text (tool args come from the model). */
function sanitize(value: unknown): string {
	const text = String(value ?? "")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "")
		.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > MAX_TOOL_DETAIL ? `${text.slice(0, MAX_TOOL_DETAIL - 1)}…` : text;
}

/** "Label: detail", or "Label..." when the tool gave nothing to show. */
const describe = (label: string, detail: string) => (detail ? `${label}: ${detail}` : `${label}...`);

function toolLine(toolName: string, args: Record<string, unknown> | undefined): string {
	const a = args ?? {};
	const file = () => sanitize(a.path || a.file_path ? path.basename(String(a.path ?? a.file_path)) : "");
	switch (toolName) {
		case "bash":
			return describe("Uploading quickhack", sanitize(a.command));
		case "read":
			return describe("Scanning shard", file());
		case "edit":
			return describe("Rewriting ICE", file());
		case "write":
			return describe("Burning shard", file());
		case "grep":
		case "find": {
			const pattern = sanitize(a.pattern);
			return pattern ? `Pinging the subnet for "${pattern}"` : "Pinging the subnet...";
		}
		case "ls":
			return describe("Mapping the subnet", sanitize(a.path ?? "."));
		case "web_search":
			return describe("Querying the Net", sanitize(a.query));
		case "web_fetch": {
			let host = "";
			try {
				host = new URL(String(a.url)).host;
			} catch {}
			const target = sanitize(host || a.url);
			return target ? `Jacking into ${target}` : "Jacking into the Net...";
		}
		default:
			return describe("Running daemon", sanitize(toolName));
	}
}

interface Run {
	ctx: ExtensionContext;
	start: number;
	line: string;
	lineStart: number;
	nextRotate: number;
	activeTools: number;
	glitchUntil: number;
	lastMessage: string;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let spinner: SpinnerName = DEFAULT_SPINNER;
	let run: Run | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let outcomeTimer: ReturnType<typeof setTimeout> | undefined;
	let outcome: "completed" | "aborted" | "error" = "completed";
	let lastPhrase = -1;

	const randomPhrase = () => {
		let i = Math.floor(Math.random() * PHRASES.length);
		if (i === lastPhrase) i = (i + 1) % PHRASES.length;
		lastPhrase = i;
		return PHRASES[i]!;
	};

	const setLine = (r: Run, line: string, now = Date.now()) => {
		r.line = line;
		r.lineStart = now;
		r.nextRotate = now + ROTATE_MS;
	};

	const renderLine = (r: Run, theme: Theme, now: number): string => {
		const elapsed = now - r.lineStart;
		if (elapsed < REVEAL_MS) {
			// Decrypt reveal: resolved prefix, scrambled tail.
			const chars = [...r.line];
			const done = Math.floor((elapsed / REVEAL_MS) * chars.length);
			const tail = chars
				.slice(done)
				.map((c) => (c === " " ? c : pick(SCRAMBLE)))
				.join("");
			return fg(theme, PRIMARY, chars.slice(0, done).join("")) + fg(theme, FAINT, tail);
		}
		if (now < r.glitchUntil) return fg(theme, ALERT, glitch(r.line));
		return fg(theme, PRIMARY, r.line);
	};

	const renderTrace = (r: Run, theme: Theme, now: number): string => {
		const t = now - r.start - TRACE_DELAY_MS;
		if (t < 0) return "";
		const phase = t % (TRACE_FULL_MS + TRACE_ALERT_MS);
		if (phase >= TRACE_FULL_MS) {
			const blinkOn = Math.floor((phase - TRACE_FULL_MS) / 300) % 2 === 0;
			return `  ${blinkOn ? fg(theme, "error", "TRACE COMPLETE") : " ".repeat(14)}`;
		}
		const pct = Math.floor((phase / TRACE_FULL_MS) * 100);
		const color: ThemeColor = pct < 50 ? "success" : pct < 80 ? "warning" : "error";
		return `  ${fg(theme, FAINT, "TRACE")} ${fg(theme, color, `${String(pct).padStart(2)}%`)}`;
	};

	const tick = () => {
		const r = run;
		if (!r) return;
		const now = Date.now();
		const theme = r.ctx.ui.theme;

		if (r.activeTools === 0 && now >= r.nextRotate) setLine(r, randomPhrase(), now);
		const revealing = now - r.lineStart < REVEAL_MS;
		if (!revealing && now >= r.glitchUntil && Math.random() < TICK_MS / GLITCH_EVERY_MS) {
			r.glitchUntil = now + GLITCH_MS;
		}

		const message = renderLine(r, theme, now) + renderTrace(r, theme, now);
		if (message !== r.lastMessage) {
			r.lastMessage = message;
			r.ctx.ui.setWorkingMessage(message);
		}
	};

	const stopRun = () => {
		clearInterval(ticker);
		ticker = undefined;
		run = undefined;
	};

	const startRun = (ctx: ExtensionContext) => {
		if (run) {
			// Automatic continuation of the same run: keep the trace clock, refresh ctx.
			run.ctx = ctx;
			return;
		}
		const now = Date.now();
		run = {
			ctx,
			start: now,
			line: "",
			lineStart: now,
			nextRotate: now,
			activeTools: 0,
			glitchUntil: 0,
			lastMessage: "",
		};
		setLine(run, randomPhrase(), now);
		tick();
		ticker = setInterval(tick, TICK_MS);
		ticker.unref?.();
	};

	const clearOutcome = (ctx: ExtensionContext) => {
		clearTimeout(outcomeTimer);
		outcomeTimer = undefined;
		ctx.ui.setStatus("netrunner", undefined);
	};

	const showOutcome = (ctx: ExtensionContext, durationMs: number) => {
		const theme = ctx.ui.theme;
		const secs = Math.max(1, Math.round(durationMs / 1000));
		const [color, text]: [ThemeColor, string] =
			outcome === "aborted"
				? ["warning", "Jacked out"]
				: outcome === "error"
					? ["error", "Flatlined"]
					: ["success", "Breach successful"];
		clearOutcome(ctx);
		ctx.ui.setStatus("netrunner", `${fg(theme, color, `◆ ${text}`)} ${fg(theme, FAINT, `${secs}s`)}`);
		outcomeTimer = setTimeout(() => clearOutcome(ctx), OUTCOME_MS);
		outcomeTimer.unref?.();
	};

	const setBanner = (ctx: ExtensionContext) => {
		ctx.ui.setHeader((_tui, theme) => ({
			render(width: number): string[] {
				const hint = fg(theme, FAINT, "/netrunner off restores pi's default header");
				return ["", ...renderLogo(theme, width), "", renderTagline(theme, width), hint, ""];
			},
			invalidate() {},
		}));
	};

	const applyIndicator = (ctx: ExtensionContext) => {
		ctx.ui.setWorkingIndicator(SPINNERS[spinner].build(ctx.ui.theme));
	};

	const applyStatic = (ctx: ExtensionContext) => {
		if (enabled) {
			applyIndicator(ctx);
			ctx.ui.setHiddenThinkingLabel(fg(ctx.ui.theme, "thinkingText", "Netrunning..."));
			setBanner(ctx);
		} else {
			ctx.ui.setWorkingIndicator();
			ctx.ui.setHiddenThinkingLabel();
			ctx.ui.setWorkingMessage();
			ctx.ui.setHeader(undefined);
			clearOutcome(ctx);
		}
	};

	const active = (ctx: ExtensionContext) => enabled && ctx.mode === "tui";

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const { data, error } = readConfig();
		if (error) ctx.ui.notify(`netrunner: ignoring ${configPath()}: ${error}`, "warning");
		spinner = isSpinner(data.spinner) ? data.spinner : DEFAULT_SPINNER;
		palette = isPalette(data.colors) ? data.colors : "theme";
		applyStatic(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!active(ctx)) return;
		clearOutcome(ctx);
		outcome = "completed";
		if (!run) applyIndicator(ctx); // re-read theme colors in case the theme changed
		startRun(ctx);
	});

	pi.on("tool_execution_start", async (event) => {
		if (!run) return;
		run.activeTools++;
		setLine(run, toolLine(event.toolName, event.args));
	});

	pi.on("tool_execution_end", async () => {
		if (!run) return;
		run.activeTools = Math.max(0, run.activeTools - 1);
		if (run.activeTools === 0) run.nextRotate = Math.min(run.nextRotate, Date.now() + TOOL_LINGER_MS);
	});

	pi.on("agent_before_settle", async (event) => {
		outcome = event.outcome;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const started = run?.start;
		stopRun();
		if (started !== undefined && active(ctx)) showOutcome(ctx, Date.now() - started);
	});

	pi.on("session_shutdown", async () => {
		stopRun();
		clearTimeout(outcomeTimer);
	});

	const setEnabled = (ctx: ExtensionContext, on: boolean) => {
		enabled = on;
		stopRun();
		applyStatic(ctx);
		if (enabled && ctx.mode === "tui" && !ctx.isIdle()) startRun(ctx);
		ctx.ui.notify(enabled ? "Jacked in." : "Jacked out.", "info");
	};

	/** Persist a setting; if that fails, the change still applies for this session. */
	const save = (ctx: ExtensionContext, patch: Record<string, unknown>, what: string) => {
		try {
			writeConfig(patch);
			ctx.ui.notify(`${what}.`, "info");
		} catch (err) {
			ctx.ui.notify(`${what} for this session, but not saved: ${(err as Error).message}`, "warning");
		}
	};

	const setSpinner = (ctx: ExtensionContext, name: SpinnerName) => {
		spinner = name;
		if (enabled && ctx.mode === "tui") applyIndicator(ctx);
		save(ctx, { spinner: name }, `Spinner set to ${SPINNERS[name].label}`);
	};

	const setPalette = (ctx: ExtensionContext, name: Palette) => {
		palette = name;
		if (enabled && ctx.mode === "tui") applyStatic(ctx); // recolor spinner, label and banner
		save(ctx, { colors: name }, `Colors set to ${name}`);
	};

	const pickPalette = async (ctx: ExtensionContext) => {
		const options = PALETTE_NAMES.map((name) => `${PALETTES[name]}${name === palette ? "  (current)" : ""}`);
		const choice = await ctx.ui.select("Netrunner colors", options);
		const name = choice === undefined ? undefined : PALETTE_NAMES[options.indexOf(choice)];
		if (name) setPalette(ctx, name);
	};

	const pickSpinner = async (ctx: ExtensionContext) => {
		const options = SPINNER_NAMES.map((name) => {
			const s = SPINNERS[name];
			return `${s.sample.padEnd(6)} ${s.label}${name === spinner ? "  (current)" : ""}`;
		});
		const choice = await ctx.ui.select("Netrunner spinner", options);
		const name = choice === undefined ? undefined : SPINNER_NAMES[options.indexOf(choice)];
		if (name) setSpinner(ctx, name);
	};

	const openMenu = async (ctx: ExtensionContext) => {
		const spinnerItem = `Spinner: ${SPINNERS[spinner].label}`;
		const colorsItem = `Colors: ${palette === "neon" ? "Neon" : "Theme"}`;
		const toggleItem = enabled ? "Turn off (this session)" : "Turn on";
		const choice = await ctx.ui.select("Netrunner", [spinnerItem, colorsItem, toggleItem]);
		if (choice === spinnerItem) await pickSpinner(ctx);
		else if (choice === colorsItem) await pickPalette(ctx);
		else if (choice === toggleItem) setEnabled(ctx, !enabled);
	};

	const usage = `/netrunner [on | off | spinner [${SPINNER_NAMES.join("|")}] | colors [${PALETTE_NAMES.join("|")}]]`;

	pi.registerCommand("netrunner", {
		description: "Netrunner settings: opens a menu, or use on | off | spinner [name] | colors [theme|neon]",
		getArgumentCompletions: (prefix) => {
			const values = prefix.startsWith("spinner ")
				? SPINNER_NAMES.map((n) => `spinner ${n}`)
				: prefix.startsWith("colors ")
					? PALETTE_NAMES.map((n) => `colors ${n}`)
					: ["on", "off", "spinner", "colors"];
			return values.filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
		},
		handler: async (args, ctx) => {
			const [cmd = "", name] = args.trim().toLowerCase().split(/\s+/);
			if (cmd === "on" || cmd === "off") return setEnabled(ctx, cmd === "on");
			if (cmd === "spinner" && name) {
				if (isSpinner(name)) return setSpinner(ctx, name);
				return ctx.ui.notify(`Unknown spinner "${name}". Options: ${SPINNER_NAMES.join(", ")}`, "error");
			}
			if (cmd === "colors" && name) {
				if (isPalette(name)) return setPalette(ctx, name);
				return ctx.ui.notify(`Unknown colors "${name}". Options: ${PALETTE_NAMES.join(", ")}`, "error");
			}
			if (!ctx.hasUI) return ctx.ui.notify(`Usage: ${usage}`, "info");
			if (cmd === "spinner") return pickSpinner(ctx);
			if (cmd === "colors") return pickPalette(ctx);
			if (cmd === "") return openMenu(ctx);
			ctx.ui.notify(`Usage: ${usage}`, "error");
		},
	});
}

// --- Startup banner -------------------------------------------------------
// Block letters in yellow with a thin cyan line shadow and a few glitch streaks,
// after the game's logo. Terminals narrower than 80 columns get a compact version.

const BIG_FONT: Record<string, string[]> = {
	N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
	E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
	T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
	R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
	U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
};
const SMALL_FONT: Record<string, string[]> = {
	N: ["╔╗╔", "║║║", "╝╚╝"],
	E: ["╔═╗", "║╣ ", "╚═╝"],
	T: ["╔╦╗", " ║ ", " ╩ "],
	R: ["╦═╗", "╠╦╝", "╩╚═"],
	U: ["╦ ╦", "║ ║", "╚═╝"],
};
const spell = (font: Record<string, string[]>) =>
	font.N!.map((_, row) => [..."NETRUNNER"].map((ch) => font[ch]![row]).join(""));
const BIG_LOGO = spell(BIG_FONT);
const SMALL_LOGO = spell(SMALL_FONT);
const BIG_WIDTH = [...BIG_LOGO[0]!].length;
const SMALL_WIDTH = [...SMALL_LOGO[0]!].length;

/** Glitch streaks: [row, from column, to column, replacement half block]. */
const STREAKS: [number, number, number, string][] = [
	[2, 13, 21, "▀"],
	[2, 53, 59, "▀"],
	[3, 35, 43, "▄"],
];

/** Letter edges that fade out in the alert color: [row, first column, glyphs]. First R and last E. */
const DECAY: [number, number, string][] = [
	[0, 30, "▓▒░"],
	[2, 30, "▓▒░"],
	[4, 68, "▓▒░"],
];

/** Signal noise framing the logo. "4E4554" is NET in hex, "01001110" is N in binary. */
function staticBand(theme: Theme): string {
	const noise = (s: string) => fg(theme, FAINT, s);
	const left = `${noise("░▒▓")}${fg(theme, PRIMARY, "█")} ${noise("0x4E4554")} ${noise("▓▒░")}`; // 17 columns
	const right = `${noise("░▒▓")} ${fg(theme, PRIMARY, "01001110")} ${fg(theme, PRIMARY, "█")}${noise("▓▒░")}`; // 17 columns
	const specks = `${" ".repeat(20)}${fg(theme, ALERT, "▖")}${" ".repeat(9)}${fg(theme, ALERT, "▝")}${" ".repeat(15)}`; // 46 columns
	return left + specks + right;
}

function tornScanline(theme: Theme): string {
	const dash = (n: number) => fg(theme, FAINT, "─ ".repeat(n));
	return `${fg(theme, FAINT, "▓▒░ ")}${dash(14)}${fg(theme, ALERT, "━━━━━")} ${dash(19)}${fg(theme, FAINT, " ░▒▓")}`; // 80 columns
}

const STATUS_TAG = "[◈ LINK UNSTABLE ◈]";

function renderTagline(theme: Theme, width: number): string {
	const text = "▌ NET ACCESS POINT";
	const version = `pi v${VERSION}`;
	const tagline = `${fg(theme, PRIMARY, text)}  ${fg(theme, FAINT, version)}`;
	const gap = BIG_WIDTH - text.length - 2 - version.length - STATUS_TAG.length;
	if (width < BIG_WIDTH || gap < 2) return tagline;
	return `${tagline}${" ".repeat(gap)}${fg(theme, ALERT, STATUS_TAG)}`;
}

function renderLogo(theme: Theme, width: number): string[] {
	if (width < SMALL_WIDTH) return [fg(theme, HIGHLIGHT, "NETRUNNER")];
	if (width < BIG_WIDTH) return SMALL_LOGO.map((line) => fg(theme, HIGHLIGHT, line));
	const logo = BIG_LOGO.map((line, row) =>
		[...line]
			.map((c, x) => {
				if (c === " ") return c;
				if (c !== "█") return fg(theme, PRIMARY, c); // box-drawing shadow
				const decay = DECAY.find(([r, from, glyphs]) => r === row && x >= from && x < from + glyphs.length);
				if (decay) return fg(theme, ALERT, decay[2][x - decay[1]]!);
				const streak = STREAKS.find(([r, from, to]) => r === row && x >= from && x <= to);
				return fg(theme, HIGHLIGHT, streak ? streak[3] : c);
			})
			.join(""),
	);
	const subtitle = `${fg(theme, PRIMARY, "N I G H T")} ${fg(theme, FAINT, "──○──")} ${fg(theme, PRIMARY, "C I T Y")}`;
	return [staticBand(theme), ...logo, `${" ".repeat(BIG_WIDTH - 23)}${subtitle}`, tornScanline(theme)];
}

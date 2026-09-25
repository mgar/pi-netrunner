// Shared test helpers: real pi themes plus a fake pi runtime that records what the extension draws.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Theme } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/netrunner.ts";

const BG_KEYS = new Set([
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

export const NETRUNNER_THEME = JSON.parse(fs.readFileSync(new URL("../themes/netrunner.json", import.meta.url), "utf8"));

/** Build a real pi Theme from theme JSON (resolving `vars`), optionally overriding colors. */
export function makeTheme(overrides = {}, mode = "truecolor", json = NETRUNNER_THEME) {
	const colors = { ...json.colors, ...overrides };
	const resolve = (value, depth = 0) => {
		if (typeof value === "number" || value === "" || value.startsWith("#")) return value;
		if (depth > 10 || !(value in json.vars)) throw new Error(`unresolvable color ${value}`);
		return resolve(json.vars[value], depth + 1);
	};
	const fg = {};
	const bg = {};
	for (const [key, value] of Object.entries(colors)) (BG_KEYS.has(key) ? bg : fg)[key] = resolve(value);
	return new Theme(fg, bg, mode, { name: "test" });
}

/** Point pi's agent dir (where netrunner.json lives) at a fresh temp directory. */
export function useTempAgentDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-netrunner-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	return { dir, config: path.join(dir, "netrunner.json") };
}

/** Load the extension against a fake pi runtime. `state` holds whatever it last drew. */
export function start({ theme = makeTheme(), mode = "tui", hasUI = true } = {}) {
	const handlers = {};
	const commands = {};
	const answers = [];
	const state = { notifications: [], menus: [] };
	let idle = true;

	extension({
		on: (event, handler) => (handlers[event] = handler),
		registerCommand: (name, options) => (commands[name] = options),
		getSessionName: () => undefined,
	});

	const ctx = {
		mode,
		hasUI,
		cwd: "/tmp/project",
		isIdle: () => idle,
		ui: {
			theme,
			setWorkingMessage: (message) => (state.message = message),
			setWorkingIndicator: (options) => (state.indicator = options),
			setHiddenThinkingLabel: (label) => (state.label = label),
			setHeader: (factory) => (state.header = factory?.(undefined, theme)),
			setStatus: (_key, text) => (state.status = text),
			notify: (message, level) => state.notifications.push({ level, message }),
			select: async (title, options) => {
				state.menus.push({ title, options });
				return answers.shift()?.(options);
			},
		},
	};

	const emit = (event, payload = {}) => handlers[event]?.({ type: event, ...payload }, ctx);
	return {
		state,
		ctx,
		emit,
		command: (args = "") => commands.netrunner.handler(args, ctx),
		complete: (prefix) => commands.netrunner.getArgumentCompletions(prefix).map((item) => item.value),
		/** Queue answers for upcoming menus; each receives the options and returns the one to pick. */
		answer: (...pickers) => answers.push(...pickers),
		banner: (width = 120) => state.header?.render(width) ?? [],
		async startRun() {
			idle = false;
			await emit("agent_start");
		},
		async settle(outcome = "completed") {
			await emit("agent_before_settle", { outcome });
			await emit("agent_settled");
			idle = true;
		},
	};
}

export const strip = (text = "") => text.replace(/\x1b\[[0-9;]*m/g, "");

/** Distinct foreground color codes in rendered text, e.g. "38;2;252;238;10". */
export const colors = (text = "") => new Set([...text.matchAll(/\x1b\[(38;[0-9;]*)m/g)].map((m) => m[1]));

export const rgbCode = (hex) => `38;2;${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";")}`;

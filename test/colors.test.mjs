import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { colors, makeTheme, rgbCode, start, useTempAgentDir } from "./helpers.mjs";

beforeEach(() => {
	useTempAgentDir();
	mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	mock.method(Math, "random", () => 0.5); // no random glitch flashes
});
afterEach(() => {
	mock.restoreAll(); // before the timer reset, so spies don't resurrect mocked timers
	mock.timers.reset();
});

const YELLOW = "#e5c890";
const SAPPHIRE = "#85c1dc";
const BLUE = "#8caaee";

// A pastel theme where accent and borderAccent are the same blue
// and the only cyan-ish color is thinkingLow.
const pastel = (mode = "truecolor") =>
	makeTheme(
		{
			warning: YELLOW,
			accent: BLUE,
			borderAccent: BLUE,
			mdLink: BLUE,
			thinkingLow: SAPPHIRE,
			syntaxType: YELLOW,
			mdCode: "#a6d189",
			syntaxVariable: "#c6d0f5",
			border: "#626880",
		},
		mode,
	);

async function loaderText(theme) {
	const pi = start({ theme });
	await pi.emit("session_start");
	await pi.startRun();
	mock.timers.tick(500);
	const message = pi.state.message;
	await pi.settle();
	return message;
}

test("picks the theme color closest to cyan for the loader text", async () => {
	assert.deepEqual(colors(await loaderText(pastel())), new Set([rgbCode(SAPPHIRE)]));
});

test("falls back to accent when the theme has no colorful candidates", async () => {
	const gray = "#808080";
	const theme = makeTheme({
		accent: gray,
		borderAccent: gray,
		thinkingLow: gray,
		syntaxType: gray,
		mdLink: gray,
		mdCode: gray,
		syntaxVariable: gray,
		border: gray,
	});
	assert.deepEqual(colors(await loaderText(theme)), new Set([rgbCode(gray)]));
});

test("draws the banner in the theme's yellow with a cyan shadow", async () => {
	const pi = start({ theme: pastel() });
	await pi.emit("session_start");
	const logo = pi.banner().slice(2, 8).join("");
	assert.ok(colors(logo).has(rgbCode(YELLOW)), "letters use warning");
	assert.ok(colors(logo).has(rgbCode(SAPPHIRE)), "shadow uses the cyan pick");
});

test("neon colors ignore the theme and use the logo's yellow and cyan", async () => {
	const pi = start({ theme: pastel() });
	await pi.emit("session_start");
	await pi.command("colors neon");
	const logo = colors(pi.banner().slice(2, 8).join(""));
	assert.ok(logo.has(rgbCode("#fcee0a")));
	assert.ok(logo.has(rgbCode("#37ebf3")));
	assert.ok(!logo.has(rgbCode(YELLOW)));

	await pi.command("colors theme");
	assert.ok(colors(pi.banner().join("")).has(rgbCode(YELLOW)), "switching back recolors the banner");
});

test("uses 256-color codes in terminals without truecolor", async () => {
	const pi = start({ theme: pastel("256color") });
	await pi.emit("session_start");
	for (const code of colors(pi.banner().join(""))) assert.match(code, /^38;5;\d+$/);
	const sapphire256 = pastel("256color").getFgAnsi("thinkingLow").slice(2, -1);
	assert.deepEqual(colors(await loaderText(pastel("256color"))), new Set([sapphire256]), "cyan pick works on 256-color codes");

	await pi.command("colors neon");
	const neon = colors(pi.banner().join(""));
	assert.ok(neon.has("38;5;226"), "neon yellow");
	assert.ok(neon.has("38;5;81"), "neon cyan");
});

test("the bundled netrunner theme looks exactly like neon mode", async () => {
	const render = async (colorsMode, mode) => {
		const pi = start({ theme: makeTheme({}, mode) }); // themes/netrunner.json
		await pi.emit("session_start");
		await pi.command(`colors ${colorsMode}`);
		await pi.startRun();
		await pi.emit("tool_execution_start", { toolName: "bash", args: { command: "npm test" } });
		mock.timers.tick(25_000); // past the reveal, with the trace showing
		const frame = { banner: pi.banner(), loader: pi.state.message, spinner: pi.state.indicator.frames, label: pi.state.label };
		await pi.settle("error");
		return { ...frame, outcome: pi.state.status };
	};
	for (const mode of ["truecolor", "256color"]) {
		assert.deepEqual(await render("theme", mode), await render("neon", mode), mode);
	}
});

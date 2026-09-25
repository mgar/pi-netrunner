import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { start, strip, useTempAgentDir } from "./helpers.mjs";

beforeEach(() => {
	useTempAgentDir();
	mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	mock.method(Math, "random", () => 0.5); // no random glitch flashes
});
afterEach(() => {
	mock.restoreAll(); // before the timer reset, so spies don't resurrect mocked timers
	mock.timers.reset();
});

async function session(options) {
	const pi = start(options);
	await pi.emit("session_start");
	return pi;
}

test("sets up the spinner, thinking label and banner at startup", async () => {
	const pi = await session();
	assert.ok(pi.state.indicator.frames.length > 0);
	assert.equal(strip(pi.state.label), "Netrunning...");
	assert.match(strip(pi.banner().join("\n")), /N I G H T ──○── C I T Y/);
});

test("leaves non-interactive modes alone", async () => {
	for (const mode of ["rpc", "json", "print"]) {
		const pi = await session({ mode });
		await pi.startRun();
		mock.timers.tick(5000);
		await pi.settle();
		assert.deepEqual(Object.keys(pi.state).sort(), ["menus", "notifications"], `${mode} mode drew nothing`);
	}
});

test("animates while pi works and stops when the run settles", async () => {
	const started = mock.method(globalThis, "setInterval");
	const cleared = mock.method(globalThis, "clearInterval");
	const pi = await session();
	await pi.startRun();
	mock.timers.tick(500);
	const first = strip(pi.state.message);
	assert.ok(first.endsWith("..."), `a phrase is shown: ${first}`);
	mock.timers.tick(2500);
	assert.notEqual(strip(pi.state.message), first, "phrases rotate");

	await pi.settle();
	const last = pi.state.message;
	mock.timers.tick(10_000);
	assert.equal(pi.state.message, last, "no updates after the run");

	const intervals = started.mock.calls.map((call) => call.result);
	assert.ok(intervals.length > 0);
	for (const handle of intervals) {
		assert.ok(cleared.mock.calls.some((call) => call.arguments[0] === handle), "every interval is cleared");
	}
});

test("shows the NetWatch trace on long runs", async () => {
	const pi = await session();
	await pi.startRun();
	mock.timers.tick(9000);
	assert.doesNotMatch(strip(pi.state.message), /TRACE/, "not in the first 10 seconds");
	mock.timers.tick(11_000); // 20s in: 10s into a 120s trace
	assert.match(strip(pi.state.message), /TRACE {2}8%$/);
	mock.timers.tick(111_000); // 131s in: past 100%
	assert.match(strip(pi.state.message), /TRACE COMPLETE| {14}$/);
	await pi.settle();
});

test("reports how the run ended, then clears it", async () => {
	for (const [outcome, text] of [
		["completed", "◆ Breach successful 3s"],
		["aborted", "◆ Jacked out 3s"],
		["error", "◆ Flatlined 3s"],
	]) {
		const pi = await session();
		await pi.startRun();
		mock.timers.tick(3000);
		await pi.settle(outcome);
		assert.equal(strip(pi.state.status), text);
		mock.timers.tick(6000);
		assert.equal(pi.state.status, undefined, "cleared after six seconds");
	}
});

test("/netrunner off restores pi's defaults and stays quiet", async () => {
	const pi = await session();
	await pi.command("off");
	assert.equal(pi.state.indicator, undefined);
	assert.equal(pi.state.label, undefined);
	assert.equal(pi.state.message, undefined);
	assert.equal(pi.state.header, undefined);
	assert.equal(pi.state.notifications.at(-1).message, "Jacked out.");

	await pi.startRun();
	mock.timers.tick(5000);
	await pi.settle();
	assert.equal(pi.state.message, undefined, "no loader text while off");
	assert.equal(pi.state.status, undefined, "no outcome while off");

	await pi.command("on");
	assert.ok(pi.state.indicator && pi.state.header, "back on");
});

test("shrinks the banner on narrow terminals", async () => {
	const pi = await session();
	const full = pi.banner(120);
	assert.equal(full.length, 14, "static band, logo, subtitle, scanline, tagline and hint");
	assert.match(strip(full.at(-3)), /\[◈ LINK UNSTABLE ◈\]$/);
	for (const line of full) assert.ok([...strip(line)].length <= 80, "full banner is 80 columns");
	assert.doesNotMatch(strip(pi.banner(60).join("\n")), /LINK UNSTABLE|0x4E4554/, "no frame on narrow terminals");
	assert.deepEqual(pi.banner(60).slice(1, 4).map(strip), [
		"╔╗╔╔═╗╔╦╗╦═╗╦ ╦╔╗╔╔╗╔╔═╗╦═╗",
		"║║║║╣  ║ ╠╦╝║ ║║║║║║║║╣ ╠╦╝",
		"╝╚╝╚═╝ ╩ ╩╚═╚═╝╝╚╝╝╚╝╚═╝╩╚═",
	]);
	assert.equal(strip(pi.banner(20)[1]), "NETRUNNER");
	for (const width of [20, 60, 120]) {
		const logo = pi.banner(width).slice(1, -4); // tagline and hint may wrap; the logo must not
		for (const line of logo) assert.ok([...strip(line)].length <= width, `logo fits in ${width} columns`);
	}
});

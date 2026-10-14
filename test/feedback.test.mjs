import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { colors, rgbCode, start, strip, useTempAgentDir } from "./helpers.mjs";

beforeEach(() => {
	useTempAgentDir();
	mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	mock.method(Math, "random", () => 0.5); // no random glitch flashes
});
afterEach(() => {
	mock.restoreAll(); // before the timer reset, so spies don't resurrect mocked timers
	mock.timers.reset();
});

// Colors of the bundled netrunner theme, which the helpers use by default.
const GREEN = rgbCode("#21f6bc");
const YELLOW = rgbCode("#fcee0a");
const RED = rgbCode("#ff003c");

async function session(options) {
	const pi = start(options);
	await pi.emit("session_start");
	return pi;
}

test("humanity meter shows the context window left", async () => {
	const pi = await session({ contextPercent: 12 });
	assert.equal(strip(pi.state.humanity), "HUMANITY 88%");
	assert.ok(colors(pi.state.humanity).has(GREEN));

	for (const [percent, text, color] of [
		[60, "HUMANITY 40%", YELLOW],
		[80, "HUMANITY 20% cyberpsychosis risk: /compact", RED],
		[103, "HUMANITY 0% cyberpsychosis risk: /compact", RED],
	]) {
		pi.setContext(percent);
		await pi.emit("turn_end");
		assert.equal(strip(pi.state.humanity), text);
		assert.ok(colors(pi.state.humanity).has(color), `${percent}% used`);
	}
});

test("humanity meter updates after runs and compaction, and handles unknown usage", async () => {
	const pi = await session({ contextPercent: 30 });
	await pi.startRun();
	pi.setContext(55);
	await pi.settle();
	assert.equal(strip(pi.state.humanity), "HUMANITY 45%", "after a run");

	pi.setContext(null); // pi doesn't know the usage right after compacting
	await pi.emit("session_compact", { reason: "manual", compactionEntry: { tokensBefore: 90_000 } });
	assert.equal(strip(pi.state.humanity), "HUMANITY --");
});

test("the ripperdoc reports what compaction pulled", async () => {
	const pi = await session();
	await pi.emit("session_compact", { reason: "manual", compactionEntry: { tokensBefore: 142_400 } });
	assert.equal(strip(pi.state.status), "◆ Ripperdoc pulled 142k tokens of chrome");
	assert.ok(colors(pi.state.status).has(GREEN));

	await pi.emit("session_compact", { reason: "overflow", compactionEntry: { tokensBefore: 199_000 } });
	assert.equal(strip(pi.state.status), "◆ Relic malfunction: ripperdoc pulled 199k tokens of chrome");
	assert.ok(colors(pi.state.status).has(RED));

	await pi.emit("session_compact_failed", { reason: "threshold", aborted: false });
	assert.equal(strip(pi.state.status), "◆ Ripperdoc botched the job: compaction failed");
	mock.timers.tick(6000);
	assert.equal(pi.state.status, undefined, "cleared after six seconds");

	await pi.emit("session_compact_failed", { reason: "manual", aborted: true });
	assert.equal(pi.state.status, undefined, "cancelling it yourself isn't a failure");
});

test("the loader shows the ripperdoc while compaction runs mid-run", async () => {
	const pi = await session();
	await pi.startRun();
	await pi.emit("session_before_compact", { reason: "threshold" });
	mock.timers.tick(10_000); // well past the 2.5s rotation
	assert.match(strip(pi.state.message), /^Ripperdoc pulling chrome\.\.\./);
	await pi.emit("session_compact", { reason: "threshold", compactionEntry: { tokensBefore: 150_000 } });
	mock.timers.tick(1500);
	assert.doesNotMatch(strip(pi.state.message), /Ripperdoc/, "back to rotating phrases");
	await pi.settle();
});

test("flashes engram swaps and Sandevistan upgrades", async () => {
	const pi = await session();
	const opus = { id: "claude-opus-5.5", name: "Claude Opus 5.5" };
	await pi.emit("model_select", { model: opus, source: "set" });
	assert.equal(strip(pi.state.status), "◆ Engram swap: Claude Opus 5.5");
	await pi.emit("model_select", { model: { id: "gpt-5" }, source: "cycle" });
	assert.equal(strip(pi.state.status), "◆ Engram swap: gpt-5", "falls back to the model id");

	for (const [level, text] of [
		["high", "◆ Sandevistan Mk.4 engaged"],
		["max", "◆ Militech Apogee Sandevistan engaged"],
		["off", "◆ Sandevistan offline"],
	]) {
		await pi.emit("thinking_level_select", { level });
		assert.equal(strip(pi.state.status), text);
	}
	mock.timers.tick(6000);

	await pi.emit("model_select", { model: opus, source: "restore" });
	assert.equal(pi.state.status, undefined, "resuming a session doesn't count as a swap");
	await pi.command("off");
	await pi.emit("model_select", { model: opus, source: "set" });
	await pi.emit("thinking_level_select", { level: "high" });
	await pi.emit("session_compact", { reason: "manual", compactionEntry: { tokensBefore: 1 } });
	assert.equal(pi.state.status, undefined, "quiet when netrunner is off");
});

test("humanity meter disappears when netrunner is off", async () => {
	const pi = await session();
	await pi.command("off");
	assert.equal(pi.state.humanity, undefined);
	await pi.emit("turn_end");
	assert.equal(pi.state.humanity, undefined, "stays hidden");
	await pi.command("on");
	assert.equal(strip(pi.state.humanity), "HUMANITY 88%");
});

test("a failed tool flashes ICE DETECTED, then recovers", async () => {
	const pi = await session();
	await pi.startRun();
	await pi.emit("tool_execution_start", { toolName: "bash", args: { command: "npm test" } });
	mock.timers.tick(500);
	await pi.emit("tool_execution_end", { isError: true });
	mock.timers.tick(100);
	assert.match(strip(pi.state.message), /^!! ICE DETECTED !! /);
	assert.ok(colors(pi.state.message).has(RED));

	mock.timers.tick(1500);
	assert.doesNotMatch(strip(pi.state.message), /ICE DETECTED/, "gone after 1.5 seconds");
	await pi.settle();
});

test("successful tools don't trigger the alert", async () => {
	const pi = await session();
	await pi.startRun();
	await pi.emit("tool_execution_start", { toolName: "read", args: { path: "a.ts" } });
	await pi.emit("tool_execution_end", { isError: false });
	for (let i = 0; i < 30; i++) {
		mock.timers.tick(50);
		assert.doesNotMatch(strip(pi.state.message), /ICE DETECTED/);
	}
	await pi.settle();
});

test("each failure pushes the NetWatch trace forward", async () => {
	const pi = await session();
	await pi.startRun();
	mock.timers.tick(5000);
	assert.doesNotMatch(strip(pi.state.message), /TRACE/, "no trace in the first 10 seconds");

	await pi.emit("tool_execution_end", { isError: true });
	mock.timers.tick(2000); // 7s in, plus 18s of boost: 15s into the trace
	assert.match(strip(pi.state.message), /TRACE 12%$/);

	await pi.emit("tool_execution_end", { isError: true });
	mock.timers.tick(2000); // 9s in, plus 36s of boost: 35s into the trace
	assert.match(strip(pi.state.message), /TRACE 29%$/);
	await pi.settle();
});

test("a dialog masks the signal: the trace and the run time stop while it waits on you", async () => {
	const pi = await session();
	await pi.startRun();
	mock.timers.tick(5000);
	await pi.emit("ui_prompt_start", { kind: "confirm" });
	mock.timers.tick(100);
	assert.equal(strip(pi.state.message), "SIGNAL MASKED · awaiting your call");
	assert.ok(colors(pi.state.message).has(YELLOW));

	mock.timers.tick(60_000); // you went for coffee
	assert.equal(strip(pi.state.message), "SIGNAL MASKED · awaiting your call", "no trace builds up");

	await pi.emit("ui_prompt_end", { kind: "confirm" });
	mock.timers.tick(6000); // 11s of actual run time: 1s into the trace
	assert.match(strip(pi.state.message), /TRACE {2}0%$/);
	await pi.settle();
	assert.equal(strip(pi.state.status), "◆ Breach successful 11s", "the wait isn't counted");
});

test("nested dialogs keep the signal masked until the last one closes", async () => {
	const pi = await session();
	await pi.emit("ui_prompt_end"); // stray end while idle: ignored
	await pi.startRun();
	await pi.emit("ui_prompt_end"); // stray end mid-run: ignored
	await pi.emit("ui_prompt_start", { kind: "select" });
	await pi.emit("ui_prompt_start", { kind: "confirm" });
	await pi.emit("ui_prompt_end", { kind: "confirm" });
	mock.timers.tick(100);
	assert.match(strip(pi.state.message), /^SIGNAL MASKED/, "one still open");
	await pi.emit("ui_prompt_end", { kind: "select" });
	mock.timers.tick(3000);
	assert.doesNotMatch(strip(pi.state.message), /SIGNAL MASKED/);
	await pi.settle();
});

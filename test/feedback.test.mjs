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
	await pi.emit("session_compact");
	assert.equal(strip(pi.state.humanity), "HUMANITY --");
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

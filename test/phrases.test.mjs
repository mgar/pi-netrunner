import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { PHRASES } from "../extensions/netrunner.ts";
import { start, strip, useTempAgentDir } from "./helpers.mjs";

beforeEach(() => {
	useTempAgentDir();
	mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
});
afterEach(() => {
	mock.restoreAll(); // before the timer reset, so spies don't resurrect mocked timers
	mock.timers.reset();
});

test("phrases are unique, short and end with an ellipsis", () => {
	assert.equal(new Set(PHRASES).size, PHRASES.length, "no duplicates");
	for (const phrase of PHRASES) {
		assert.ok([...phrase].length <= 44, `fits next to the trace meter: ${phrase}`);
		assert.ok(phrase.endsWith("..."), `reads as ongoing work: ${phrase}`);
	}
});

test("shows every phrase once before repeating any", async () => {
	let seed = 1;
	mock.method(Math, "random", () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.98 + 0.01); // seeded, never low enough to glitch
	const pi = start();
	await pi.emit("session_start");
	await pi.startRun();

	// Advance in the extension's own 50 ms steps so each rotation happens at its real time.
	const advance = (ms) => {
		for (let t = 0; t < ms; t += 50) mock.timers.tick(50);
	};
	const shown = [];
	advance(500); // first phrase, past the decrypt reveal
	for (let i = 0; i < PHRASES.length * 2; i++) {
		shown.push(strip(pi.state.message).split("  TRACE")[0].trim());
		advance(2500);
	}
	await pi.settle();

	const firstRound = shown.slice(0, PHRASES.length);
	assert.deepEqual([...firstRound].sort(), [...PHRASES].sort(), "the first round shows each phrase exactly once");
	for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1], `no back-to-back repeat at ${i}`);
});

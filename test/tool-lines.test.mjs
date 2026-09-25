import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { start, strip, useTempAgentDir } from "./helpers.mjs";

useTempAgentDir();

beforeEach(() => {
	mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	mock.method(Math, "random", () => 0.5); // no random glitch flashes
});
afterEach(() => {
	mock.restoreAll(); // before the timer reset, so spies don't resurrect mocked timers
	mock.timers.reset();
});

/** Start a run, run one tool, and return the loader text once the decrypt reveal finishes. */
async function lineFor(toolName, args) {
	const pi = start();
	await pi.emit("session_start");
	await pi.startRun();
	await pi.emit("tool_execution_start", { toolName, args });
	mock.timers.tick(500);
	const line = pi.state.message;
	await pi.settle();
	return line;
}

test("describes what each tool is doing", async () => {
	assert.equal(strip(await lineFor("bash", { command: "git status" })), "Uploading quickhack: git status");
	assert.equal(strip(await lineFor("read", { path: "/repo/src/README.md" })), "Scanning shard: README.md");
	assert.equal(strip(await lineFor("edit", { path: "app.ts" })), "Rewriting ICE: app.ts");
	assert.equal(strip(await lineFor("grep", { pattern: "TODO" })), 'Pinging the subnet for "TODO"');
	assert.equal(strip(await lineFor("web_fetch", { url: "https://example.com/a/b" })), "Jacking into example.com");
	assert.equal(strip(await lineFor("mystery_tool", {})), "Running daemon: mystery_tool");
});

test("falls back to a plain label when the tool gives nothing to show", async () => {
	assert.equal(strip(await lineFor("edit", undefined)), "Rewriting ICE...");
	assert.equal(strip(await lineFor("grep", {})), "Pinging the subnet...");
});

test("strips terminal escapes and control characters from tool arguments", async () => {
	const hostile = "git status\x1b]0;pwned\x07 && echo \x1b[31mhi\x1b[0m\nthere\x00";
	const line = await lineFor("bash", { command: hostile });
	assert.equal(strip(line), "Uploading quickhack: git status && echo hi there");
	// The only escapes left are the extension's own color codes.
	assert.doesNotMatch(line, /\x1b(?!\[[0-9;]*m)/);
	assert.doesNotMatch(line, /pwned|\x07|\x00|\n/);
});

test("truncates long arguments", async () => {
	const line = strip(await lineFor("bash", { command: "x".repeat(200) }));
	assert.equal(line, `Uploading quickhack: ${"x".repeat(47)}…`);
});

test("goes back to rotating phrases after the tools finish", async () => {
	const pi = start();
	await pi.emit("session_start");
	await pi.startRun();
	await pi.emit("tool_execution_start", { toolName: "bash", args: { command: "npm test" } });
	mock.timers.tick(5000); // tool still running: line stays
	assert.equal(strip(pi.state.message), "Uploading quickhack: npm test");
	await pi.emit("tool_execution_end");
	mock.timers.tick(1500);
	assert.doesNotMatch(strip(pi.state.message), /quickhack/);
	await pi.settle();
});

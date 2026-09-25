import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, test } from "node:test";
import { start, useTempAgentDir } from "./helpers.mjs";

let config;
beforeEach(() => {
	config = useTempAgentDir().config;
});

const readConfig = () => JSON.parse(fs.readFileSync(config, "utf8"));
const lastNotification = (pi) => pi.state.notifications.at(-1);

async function session() {
	const pi = start();
	await pi.emit("session_start");
	return pi;
}

test("uses the data noise spinner when there is no settings file", async () => {
	const pi = await session();
	assert.equal(pi.state.indicator.frames.length, 48);
	assert.equal(pi.state.indicator.intervalMs, 80);
	assert.equal(fs.existsSync(config), false, "nothing is written until the user changes a setting");
});

test("saves choices made in the menu and restores them in the next session", async () => {
	const pi = await session();
	pi.answer(
		(options) => options.find((o) => o.startsWith("Spinner:")),
		(options) => options.find((o) => o.includes("Scanner sweep")),
	);
	await pi.command("");
	assert.deepEqual(pi.state.menus[0].options, ["Spinner: Data noise", "Colors: Theme", "Turn off (this session)"]);
	assert.deepEqual(readConfig(), { spinner: "scanner" });

	pi.answer(
		(options) => options.find((o) => o.startsWith("Colors:")),
		(options) => options.find((o) => o.startsWith("Neon")),
	);
	await pi.command("");
	assert.deepEqual(readConfig(), { spinner: "scanner", colors: "neon" });

	const next = await session();
	assert.equal(next.state.indicator.intervalMs, 90, "scanner spinner restored");
	assert.equal(next.state.indicator.frames.length, 8);
});

test("cancelling a picker changes nothing", async () => {
	const pi = await session();
	pi.answer(() => undefined);
	await pi.command("spinner");
	assert.equal(fs.existsSync(config), false);
	assert.equal(pi.state.notifications.length, 0);
});

test("sets values directly and keeps unrelated keys in the file", async () => {
	fs.writeFileSync(config, JSON.stringify({ somethingElse: 1 }));
	const pi = await session();
	await pi.command("spinner optic");
	await pi.command("colors neon");
	assert.deepEqual(readConfig(), { somethingElse: 1, spinner: "optic", colors: "neon" });
	assert.deepEqual(lastNotification(pi), { level: "info", message: "Colors set to neon." });
});

test("rejects unknown names", async () => {
	const pi = await session();
	await pi.command("spinner bogus");
	assert.equal(lastNotification(pi).level, "error");
	assert.match(lastNotification(pi).message, /Unknown spinner "bogus"/);
	await pi.command("colors rainbow");
	assert.match(lastNotification(pi).message, /Unknown colors "rainbow"/);
	assert.equal(fs.existsSync(config), false);
});

test("falls back to defaults for unknown values in the file", async () => {
	fs.writeFileSync(config, JSON.stringify({ spinner: "nope", colors: "nope" }));
	const pi = await session();
	assert.equal(pi.state.indicator.intervalMs, 80, "data noise");
	assert.deepEqual(pi.state.notifications, []);
});

test("warns about a broken file and never overwrites it", async () => {
	fs.writeFileSync(config, "{broken");
	const pi = await session();
	assert.equal(pi.state.notifications[0].level, "warning");
	assert.match(pi.state.notifications[0].message, /ignoring .*netrunner\.json/);
	assert.equal(pi.state.indicator.intervalMs, 80, "defaults still apply");

	await pi.command("spinner uplink");
	assert.equal(pi.state.indicator.intervalMs, 70, "the choice still applies for this session");
	assert.match(lastNotification(pi).message, /for this session, but not saved/);
	assert.equal(fs.readFileSync(config, "utf8"), "{broken");
});

test("completes subcommands and values", async () => {
	const pi = await session();
	assert.deepEqual(pi.complete(""), ["on", "off", "spinner", "colors"]);
	assert.deepEqual(pi.complete("spinner s"), ["spinner scanner", "spinner shade"]);
	assert.deepEqual(pi.complete("colors "), ["colors theme", "colors neon"]);
});

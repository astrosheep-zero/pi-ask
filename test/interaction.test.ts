import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runQuestionnaire, supportsQuestionnaire } from "../src/interaction.ts";
import { normalizeQuestions, type AskResult } from "../src/state.ts";

const questions = normalizeQuestions([{ id: "one", prompt: "Pick", options: [
	{ value: "a", label: "Same" }, { value: "b", label: "Same" },
] }]);

test("mode routing rejects headless clients and RPC never calls custom", async () => {
	assert.equal(supportsQuestionnaire({ mode: "rpc", hasUI: true }), true);
	assert.equal(supportsQuestionnaire({ mode: "tui", hasUI: false }), false);
	assert.equal(supportsQuestionnaire({ mode: "json", hasUI: false }), false);
	const ctx = {
		mode: "rpc", hasUI: true,
		ui: {
			async custom() { throw new Error("RPC cannot render custom TUI"); },
			async select(_title: string, options: string[]) { return options[1]; },
			async input() { return ""; },
		},
	} as unknown as ExtensionContext;
	assert.equal((await runQuestionnaire(ctx, questions)).answers[0].value, "b");
	await assert.rejects(runQuestionnaire({ ...ctx, hasUI: false }, questions), /UI client/);
});

test("terminal number-key selection keeps quick submit and matches the shared answer contract", async () => {
	let result: AskResult | undefined;
	const ctx = {
		mode: "tui", hasUI: true,
		ui: {
			async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
				const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
				const component = await factory(
					{ requestRender() {} } as never, theme as never, {} as never,
					value => { result = value as AskResult; },
				);
				component.handleInput?.("2");
				return result;
			},
			async select() { throw new Error("Terminal must retain its custom renderer"); },
		},
	} as unknown as ExtensionContext;
	const answer = await runQuestionnaire(ctx, questions);
	assert.equal(answer.cancelled, false);
	assert.deepEqual(answer.answers, [{ id: "one", value: "b", label: "Same", wasCustom: false, index: 2 }]);
});

test("terminal s key skips a single question and submits as skipped", async () => {
	let result: AskResult | undefined;
	const ctx = {
		mode: "tui", hasUI: true,
		ui: {
			async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
				const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };
				const component = await factory(
					{ requestRender() {} } as never, theme as never, {} as never,
					value => { result = value as AskResult; },
				);
				component.handleInput?.("s");
				return result;
			},
			async select() { throw new Error("Terminal must retain its custom renderer"); },
		},
	} as unknown as ExtensionContext;
	const answer = await runQuestionnaire(ctx, questions);
	assert.equal(answer.cancelled, false);
	assert.deepEqual(answer.answers, []);
	assert.deepEqual(answer.skipped, ["one"]);
});

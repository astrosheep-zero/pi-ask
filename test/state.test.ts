import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAskEnabled, parseConfig } from "../src/config.ts";
import {
	allAnswered,
	type Answer,
	buildSummaryText,
	errorResult,
	normalizeQuestions,
} from "../src/state.ts";

const twoQuestions = [
	{
		id: "scope",
		prompt: "How wide should the change be?",
		options: [
			{ value: "narrow", label: "Narrow" },
			{ value: "wide", label: "Wide", recommended: true },
		],
	},
	{
		id: "tests",
		label: "Tests",
		prompt: "What tests should run?",
		allowOther: false,
		options: [
			{ value: "key", label: "Key paths only" },
			{ value: "full", label: "Full suite" },
		],
	},
];

describe("normalizeQuestions", () => {
	it("fills default tab labels and allowOther", () => {
		const [a, b] = normalizeQuestions(twoQuestions);
		assert.equal(a.label, "Q1");
		assert.equal(a.allowOther, true);
		assert.equal(b.label, "Tests"); // explicit label kept
		assert.equal(b.allowOther, false); // explicit false kept
	});

	it("rejects empty input, duplicates, and missing options", () => {
		assert.throws(() => normalizeQuestions([]), /No questions/);
		assert.throws(
			() => normalizeQuestions([twoQuestions[0], { ...twoQuestions[1], id: "scope" }]),
			/Duplicate question id/,
		);
		assert.throws(
			() => normalizeQuestions([{ id: "x", prompt: "?", options: [] }]),
			/no options/,
		);
		assert.throws(
			() =>
				normalizeQuestions([
					{ id: "x", prompt: "?", options: [
						{ value: "a", label: "A" },
						{ value: "a", label: "A again" },
					] },
				]),
			/duplicate option value/,
		);
	});

	it("rejects more than 4 questions", () => {
		const five = Array.from({ length: 5 }, (_, i) => ({
			id: `q${i}`,
			prompt: "?",
			options: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
			],
		}));
		assert.throws(() => normalizeQuestions(five), /Too many questions/);
	});
});

describe("buildSummaryText / allAnswered", () => {
	it("formats selected and written answers", () => {
		const questions = normalizeQuestions(twoQuestions);
		const answers: Answer[] = [
			{ id: "scope", value: "wide", label: "Wide", wasCustom: false, index: 2 },
			{ id: "tests", value: "只跑关键的", label: "只跑关键的", wasCustom: true },
		];
		assert.equal(
			buildSummaryText(questions, answers),
			"Q1: user selected: 2. Wide\nTests: user wrote: 只跑关键的",
		);
		assert.equal(
			buildSummaryText(questions, answers, [{ id: "scope", text: "别动 legacy 那块" }], "赶时间，直接干"),
			"Q1: user selected: 2. Wide\nTests: user wrote: 只跑关键的\nQ1 (user notes): 别动 legacy 那块\nglobal note: 赶时间，直接干",
		);
		assert.equal(
			buildSummaryText(questions, [answers[0]], [{ id: "scope", text: "别动 legacy 那块" }], undefined, ["tests"]),
			"Q1: user selected: 2. Wide\nTests: skipped by user\nQ1 (user notes): 别动 legacy 那块",
		);
		assert.equal(allAnswered(questions, new Map(answers.map((a) => [a.id, a]))), true);
		assert.equal(allAnswered(questions, new Map([["scope", answers[0]]])), false);
	});
});

describe("errorResult", () => {
	it("is a cancelled envelope with the message", () => {
		const r = errorResult("boom");
		assert.equal(r.content[0].text, "boom");
		assert.equal(r.details.cancelled, true);
		assert.deepEqual(r.details.answers, []);
		assert.deepEqual(r.details.notes, []);
		assert.deepEqual(r.details.skipped, []);
	});
});

describe("parseConfig", () => {
	it("defaults to off, honors explicit on/off, and survives garbage", () => {
		assert.equal(isAskEnabled(parseConfig("{}")), false);
		assert.equal(isAskEnabled(parseConfig("not json")), false);
		assert.equal(isAskEnabled(parseConfig('{"enabled": true}')), true);
		assert.equal(isAskEnabled(parseConfig('{"enabled": false}')), false);
		assert.deepEqual(parseConfig('{"enabled": false}'), { enabled: false });
		assert.deepEqual(parseConfig("not json"), {});
		assert.deepEqual(parseConfig('{"enabled": "yes"}'), { enabled: undefined });
		assert.deepEqual(parseConfig("42"), {});
	});
});

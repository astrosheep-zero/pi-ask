import assert from "node:assert/strict";
import { test } from "node:test";
import { Questionnaire } from "../src/state.ts";
import { normalizeBatch, batchDetails, type BatchQuestion } from "../src/batch.ts";
import { runRpcDialog } from "../src/rpc-dialog.ts";

export const batch: BatchQuestion[] = [
	{ header: "Scope", question: "How much?", options: [{ label: "Small", description: "Recommended" }, { label: "Large", description: "Everything" }] },
	{ header: "Tests", question: "Which tests?", options: [{ label: "Key paths", description: "Fast" }, { label: "All", description: "Thorough" }] },
];

test("batch rejects ambiguous host keys, reserved labels and unsupported option counts", () => {
	assert.throws(() => normalizeBatch([batch[0], { ...batch[1], header: "Scope" }]), /headers/);
	assert.throws(() => normalizeBatch([batch[0], { ...batch[1], question: "How much?" }]), /texts/);
	for (const label of ["Small", "Other", "Type something.", "Next"]) {
		assert.throws(() => normalizeBatch([{ ...batch[0], options: [batch[0].options[0], { label, description: "" }] }]), /labels/);
	}
	assert.throws(() => normalizeBatch([{ ...batch[0], options: [batch[0].options[0]] }]), /2–4/);
});

test("core drafts, submission and cancellation remain distinct", () => {
	const model = new Questionnaire(normalizeBatch(batch));
	model.setNote("q1", "note");
	assert.equal(model.complete, false);
	assert.equal("cancelled" in model.snapshot(), false);
	assert.throws(() => model.submit(), /Answer all/);
	model.select("q1", 0);
	model.write("q2", "custom");
	assert.equal(model.submit().cancelled, false);
	assert.equal(model.cancel().cancelled, true);
	model.setNote("q1", "");
	assert.deepEqual(model.snapshot().notes, []);
});

test("skips count toward completion; answering or unskipping clears them", () => {
	const model = new Questionnaire(normalizeBatch(batch));
	model.skip("q1");
	assert.equal(model.complete, false); // q2 still open
	model.select("q2", 0);
	assert.equal(model.complete, true); // a skip counts
	const submitted = model.submit();
	assert.deepEqual(submitted.skipped, ["q1"]);
	assert.deepEqual(submitted.answers.map(a => a.id), ["q2"]);
	model.skip("q2"); // skipping an answered question drops the answer
	assert.equal(model.answers.has("q2"), false);
	assert.equal(model.complete, true); // both skipped
	model.select("q1", 1); // answering clears the skip
	assert.equal(model.skipped.has("q1"), false);
	model.unskip("q2");
	assert.equal(model.complete, false);
	// notes survive skips
	model.setNote("q2", "whatever");
	model.skip("q2");
	assert.deepEqual(model.snapshot().notes, [{ id: "q2", text: "whatever" }]);
	assert.deepEqual(model.snapshot().skipped, ["q2"]);
});

test("batch consumes exactly the expected select/custom replies, with no note or review prompts", async () => {
	let selects = 0;
	let inputs = 0;
	const result = await runRpcDialog({
		async select(_title, choices) {
			selects++;
			assert.equal(choices.length, 4);
			assert.equal(choices[2], "3. Type something.");
			assert.equal(choices[3], "4. Skip this question");
			return selects === 1 ? choices[0] : choices[2];
		},
		async input() { inputs++; return "Only smoke tests"; },
	}, normalizeBatch(batch));
	assert.equal(selects, 2);
	assert.equal(inputs, 1);
	assert.deepEqual(result.notes, []);
	assert.equal(result.globalNote, undefined);
	assert.deepEqual(batchDetails(result), { cancelled: false, answers: [
		{ question: "How much?", kind: "option", answer: "Small" },
		{ question: "Which tests?", kind: "custom", answer: "Only smoke tests" },
	], skipped: [] });
});

test("batch skip row skips the question without extra prompts", async () => {
	let selects = 0;
	const result = await runRpcDialog({
		async select(_title, choices) {
			selects++;
			return selects === 1 ? choices[0] : choices[3]; // "Skip this question"
		},
		async input() { throw new Error("skip must not prompt for text"); },
	}, normalizeBatch(batch));
	assert.equal(selects, 2);
	assert.deepEqual(result.skipped, ["q2"]);
	assert.deepEqual(result.notes, []);
	assert.deepEqual(batchDetails(result), { cancelled: false, answers: [
		{ question: "How much?", kind: "option", answer: "Small" },
	], skipped: ["Which tests?"] });
});

test("dismissal and abort open no follow-up questions", async () => {
	const abort = new AbortController();
	let calls = 0;
	const ui = {
		async select(_title: string, _choices: string[], opts?: { signal?: AbortSignal }) {
			calls++;
			assert.equal(opts?.signal, abort.signal);
			return undefined;
		},
		async input(): Promise<string> { throw new Error("Unexpected follow-up"); },
	};
	assert.equal((await runRpcDialog(ui, normalizeBatch(batch), abort.signal)).cancelled, true);
	abort.abort();
	assert.equal((await runRpcDialog(ui, normalizeBatch(batch), abort.signal)).cancelled, true);
	assert.equal(calls, 1);
});

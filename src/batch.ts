/** Wire contract recognized by Paseo's existing rpiv-ask-user-question adapter. */
import { Type, type Static } from "typebox";
import { normalizeQuestions, type AskResult } from "./state.ts";

export const BATCH_TOOL = "ask_user_question";
export const BatchParams = Type.Object({
	questions: Type.Array(Type.Object({
		header: Type.String({ minLength: 1, description: "Unique short tab title." }),
		question: Type.String({ minLength: 1, description: "Question text; unique within this questionnaire." }),
		options: Type.Array(Type.Object({
			label: Type.String({ minLength: 1, description: "Distinct answer label. Do not use Other, Type something., or Next. Mark recommendations in the description." }),
			description: Type.String({ description: "Brief explanation displayed below the answer label." }),
		}, { additionalProperties: false }), { minItems: 2, maxItems: 4 }),
	}, { additionalProperties: false }), { minItems: 1, maxItems: 4 }),
}, { additionalProperties: false });
export type BatchQuestion = Static<typeof BatchParams>["questions"][number];

export function normalizeBatch(questions: BatchQuestion[]) {
	const headers = new Set<string>();
	const prompts = new Set<string>();
	for (const q of questions) {
		if (!q.header.trim() || headers.has(q.header)) throw new Error("Question headers must be nonempty and unique");
		if (prompts.has(q.question)) throw new Error("Question texts must be unique");
		headers.add(q.header);
		prompts.add(q.question);
		const labels = q.options.map(option => option.label);
		if (q.options.length < 2 || q.options.length > 4) throw new Error("Each question needs 2–4 options");
		if (new Set(labels).size !== labels.length || labels.some(label => ["Other", "Type something.", "Next"].includes(label))) {
			throw new Error("Answer labels must be unique and must not use reserved navigation labels");
		}
	}
	return normalizeQuestions(questions.map((q, index) => ({
		id: `q${index + 1}`,
		label: q.header,
		prompt: q.question,
		options: q.options.map(option => ({ ...option, value: option.label })),
		allowOther: true,
	})));
}

/** Preserve the adapter's result shape so history shows answers, not protocol chatter.
 *  Skips live outside `answers`: the host's result schema only allows
 *  kind option|custom|multi, so a skipped entry would fail its whole parse. */
export function batchDetails(result: AskResult) {
	return {
		cancelled: result.cancelled,
		answers: result.answers.map(answer => ({
			question: result.questions.find(q => q.id === answer.id)!.prompt,
			kind: answer.wasCustom ? "custom" as const : "option" as const,
			answer: answer.label,
		})),
		skipped: result.skipped.map(id => result.questions.find(q => q.id === id)!.prompt),
	};
}

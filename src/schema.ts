/**
 * TypeBox schema for the ask_user tool parameters.
 */

import { Type } from "typebox";

export const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value handed back to you when this option is selected" }),
	label: Type.String({ description: "Short display label for the option" }),
	description: Type.Optional(
		Type.String({ description: "One line shown under the label: what this choice means or costs" }),
	),
	recommended: Type.Optional(
		Type.Boolean({ description: "Mark this as your recommended choice (shown with a star)" }),
	),
});

export const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question, e.g. 'scope'" }),
	label: Type.Optional(
		Type.String({ description: "Short tab label, e.g. 'Scope' (defaults to Q1, Q2, ...)" }),
	),
	prompt: Type.String({ description: "The full question text shown to the user" }),
	options: Type.Array(QuestionOptionSchema, {
		minItems: 2,
		maxItems: 6,
		description: "2-6 authored choices for the user to pick from",
	}),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Append a 'Type something.' free-text row (default: true)" }),
	),
});

export const AskUserParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 4,
		description:
			"1-4 questions in one tabbed terminal questionnaire. Batch related decisions instead of separate tool calls.",
	}),
});

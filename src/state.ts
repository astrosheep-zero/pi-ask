/**
 * Pure state/logic for the ask_user tool — no UI imports, unit-testable.
 */

export interface QuestionOption {
	value: string;
	label: string;
	description?: string;
	recommended?: boolean;
}

/** Raw question shape as it arrives from the model (pre-normalization). */
export interface RawQuestion {
	id: string;
	label?: string;
	prompt: string;
	options: QuestionOption[];
	allowOther?: boolean;
}

export interface Question {
	id: string;
	label: string;
	prompt: string;
	options: QuestionOption[];
	allowOther: boolean;
}

export interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	/** 1-based option index when a listed option was picked. */
	index?: number;
}

export interface Note {
	id: string;
	text: string;
}

export interface AskResult {
	questions: Question[];
	answers: Answer[];
	/** Per-question notes the user attached with the n key (never marks a question answered). */
	notes: Note[];
	/** Ids of questions the user deliberately skipped (in question order). Skipped counts toward completion. */
	skipped: string[];
	/** One note for the whole questionnaire, attached from the Review tab. */
	globalNote?: string;
	cancelled: boolean;
}

/**
 * Validate and normalize raw questions: default tab labels, default allowOther.
 * Throws Error with a model-readable message on invalid input.
 */
export function normalizeQuestions(raw: RawQuestion[]): Question[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error("No questions provided");
	}
	if (raw.length > 4) {
		throw new Error(`Too many questions (${raw.length}); ask at most 4 at once`);
	}

	const seen = new Set<string>();
	return raw.map((q, i) => {
		if (!q.id || !q.id.trim()) throw new Error(`Question ${i + 1} is missing an id`);
		if (seen.has(q.id)) throw new Error(`Duplicate question id: "${q.id}"`);
		seen.add(q.id);

		if (!q.prompt || !q.prompt.trim()) throw new Error(`Question "${q.id}" is missing a prompt`);
		if (!Array.isArray(q.options) || q.options.length === 0) {
			throw new Error(`Question "${q.id}" has no options`);
		}
		const values = new Set<string>();
		for (const opt of q.options) {
			if (!opt.value || !opt.label) throw new Error(`Question "${q.id}" has an option missing value or label`);
			if (values.has(opt.value)) {
				throw new Error(`Question "${q.id}" has duplicate option value: "${opt.value}"`);
			}
			values.add(opt.value);
		}

		return {
			id: q.id,
			label: q.label?.trim() || `Q${i + 1}`,
			prompt: q.prompt,
			options: q.options,
			allowOther: q.allowOther !== false,
		};
	});
}

/** Shared questionnaire semantics. Navigation and widgets belong to each renderer. */
export class Questionnaire {
	readonly questions: Question[];
	private readonly answerMap = new Map<string, Answer>();
	private readonly noteMap = new Map<string, string>();
	private readonly skipSet = new Set<string>();
	private wholeNote: string | undefined;

	constructor(questions: Question[]) {
		this.questions = questions;
	}

	get answers(): ReadonlyMap<string, Answer> { return this.answerMap; }
	get notes(): ReadonlyMap<string, string> { return this.noteMap; }
	get skipped(): ReadonlySet<string> { return this.skipSet; }
	get globalNote(): string | undefined { return this.wholeNote; }
	get complete(): boolean {
		return this.questions.every((q) => this.answerMap.has(q.id) || this.skipSet.has(q.id));
	}

	private question(id: string): Question {
		const question = this.questions.find(q => q.id === id);
		if (!question) throw new Error(`Unknown question: ${id}`);
		return question;
	}

	select(id: string, index: number): void {
		const option = this.question(id).options[index];
		if (!Number.isInteger(index) || !option) throw new Error(`Invalid option index: ${index}`);
		this.skipSet.delete(id);
		this.answerMap.set(id, { id, value: option.value, label: option.label, wasCustom: false, index: index + 1 });
	}

	write(id: string, text: string): void {
		if (!this.question(id).allowOther) throw new Error(`Custom answers are disabled for ${id}`);
		const answer = text.trim() || "(no response)";
		this.skipSet.delete(id);
		this.answerMap.set(id, { id, value: answer, label: answer, wasCustom: true });
	}

	/** Deliberately skip a question: drops any answer, keeps any note. Answering clears the skip. */
	skip(id: string): void {
		this.question(id);
		this.answerMap.delete(id);
		this.skipSet.add(id);
	}

	unskip(id: string): void {
		this.question(id);
		this.skipSet.delete(id);
	}

	setNote(id: string, value: string): void {
		this.question(id);
		const text = value.trim();
		if (text) this.noteMap.set(id, text);
		else this.noteMap.delete(id);
	}

	setGlobalNote(text: string): void { this.wholeNote = text.trim() || undefined; }

	/** A review snapshot is not a submission or a cancellation. */
	snapshot(): Omit<AskResult, "cancelled"> {
		return {
			questions: this.questions,
			answers: Array.from(this.answerMap.values(), answer => ({ ...answer })),
			notes: Array.from(this.noteMap, ([id, text]) => ({ id, text })),
			skipped: this.questions.filter((q) => this.skipSet.has(q.id)).map((q) => q.id),
			globalNote: this.wholeNote,
		};
	}

	submit(): AskResult {
		if (!this.complete) throw new Error("Answer all questions before submitting");
		return { ...this.snapshot(), cancelled: false };
	}

	cancel(): AskResult { return { ...this.snapshot(), cancelled: true }; }
}

export function allAnswered(questions: Question[], answers: ReadonlyMap<string, Answer>): boolean {
	return questions.every((q) => answers.has(q.id));
}

/** Model-facing one-line-per-answer summary of a completed dialog. */
export function buildSummaryText(
	questions: Question[],
	answers: Answer[],
	notes: Note[] = [],
	globalNote?: string,
	skipped: string[] = [],
): string {
	const lines = answers.map((a) => {
		const label = questions.find((q) => q.id === a.id)?.label || a.id;
		if (a.wasCustom) return `${label}: user wrote: ${a.label}`;
		return `${label}: user selected: ${a.index}. ${a.label}`;
	});
	for (const id of skipped) {
		const label = questions.find((q) => q.id === id)?.label || id;
		lines.push(`${label}: skipped by user`);
	}
	for (const n of notes) {
		const label = questions.find((q) => q.id === n.id)?.label || n.id;
		lines.push(`${label} (user notes): ${n.text}`);
	}
	if (globalNote) lines.push(`global note: ${globalNote}`);
	return lines.join("\n");
}

export interface ToolResultLike {
	content: { type: "text"; text: string }[];
	details: AskResult;
}

/** Error/cancel envelope: cancelled=true and empty answers. */
export function errorResult(message: string): ToolResultLike {
	return {
		content: [{ type: "text", text: message }],
		details: { questions: [], answers: [], notes: [], skipped: [], cancelled: true },
	};
}

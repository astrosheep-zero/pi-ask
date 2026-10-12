/**
 * Terminal dialog for the ask_user tool.
 *
 * Rendered in the bottom input area with accent rules, like pi's built-in
 * dialogs: highlighted selected row, accent number badges, dim descriptions,
 * tab pills on top when there is more than one question.
 *
 * Keys:
 *   1-9       jump-select an option (no arrow-key grinding)
 *   ↑/↓       move selection
 *   Enter     confirm option / save free text
 *   n         attach a note to this question (on Review: a global note)
 *   s         skip this question deliberately (toggle; counts toward Submit)
 *   Tab/←→    switch question (multi-question only)
 *   Esc       leave free-text input (discards), else dismiss the whole dialog
 */

import { type ExtensionContext, rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Questionnaire, type AskResult, type Question, type QuestionOption } from "./state.ts";

export const OTHER_LABEL = "Type something.";

type RenderOption = QuestionOption & { isOther?: boolean };

function renderOptionsFor(q: Question): RenderOption[] {
	const opts: RenderOption[] = [...q.options];
	if (q.allowOther) opts.push({ value: "__other__", label: OTHER_LABEL, isOther: true });
	return opts;
}

/**
 * Dialog chrome: takes over the bottom input area with accent rules, like pi's
 * built-in dialogs. One mode, no configuration.
 */
function makeChrome(theme: Theme, width: number, title: string) {
	const border = (s: string) => theme.fg("accent", s);
	const titleText = ` ${theme.bold(theme.fg("accent", title))} `;
	const inner = Math.max(1, width);
	const top = border("─") + titleText + border("─".repeat(Math.max(0, width - 3 - visibleWidth(title))));
	const bottom = border("─".repeat(width));

	function wrapped(content: string, prefix = ""): string[] {
		const avail = Math.max(1, inner - visibleWidth(prefix));
		return wrapTextWithAnsi(content, avail).map(
			(p, i) => `${i === 0 ? prefix : " ".repeat(visibleWidth(prefix))}${p}`,
		);
	}

	return { inner, top, bottom, line: (content = "") => content, wrapped };
}

export async function runAskDialog(ctx: ExtensionContext, questions: Question[]): Promise<AskResult> {
	const isMulti = questions.length > 1;
	const totalTabs = questions.length + 1; // questions + Submit (multi only)

	return ctx.ui.custom<AskResult>(
		(tui, theme, _kb, done) => {
			let currentTab = 0;
			let optionIndex = 0;
			let input: null | "answer" | "note" | "global" = null;
			let cachedLines: string[] | undefined;
			const model = new Questionnaire(questions);
			const { answers, notes, skipped } = model;

			const editorTheme: EditorTheme = {
				borderColor: (s) => theme.fg("accent", s),
				selectList: {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				},
			};
			const editor = new Editor(tui, editorTheme);

			// One attention bell per dialog; terminal decides audible/visual/none.
			if (process.stdout.isTTY) process.stdout.write("\x07");

			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function submit(cancelled: boolean) {
				done(cancelled ? model.cancel() : model.submit());
			}

			function advanceAfterAnswer() {
				if (!isMulti) {
					submit(false);
					return;
				}
				currentTab = currentTab < questions.length - 1 ? currentTab + 1 : questions.length; // last → Submit tab
				optionIndex = 0;
				refresh();
			}

			function pickOption(index: number) {
				const q = questions[currentTab];
				if (!q) return;
				const opt = renderOptionsFor(q)[index];
				if (!opt) return;
				if (opt.isOther) {
					input = "answer";
					editor.setText("");
					refresh();
					return;
				}
				model.select(q.id, index);
				advanceAfterAnswer();
			}

			editor.onSubmit = (value) => {
				if (input === null) return;
				if (input === "answer") {
					const q = questions[currentTab];
					if (!q) return;
					model.write(q.id, value);
					input = null;
					editor.setText("");
					advanceAfterAnswer();
					return;
				}
				// Notes: empty text deletes; notes never advance the tab or mark an answer.
				if (input === "note") {
					const q = questions[currentTab];
					if (q) model.setNote(q.id, value);
				} else {
					model.setGlobalNote(value);
				}
				input = null;
				editor.setText("");
				refresh();
			};

			function handleInput(data: string) {
				// Free-text input owns all keys while active.
				if (input !== null) {
					if (matchesKey(data, Key.escape)) {
						input = null;
						editor.setText("");
						refresh();
						return;
					}
					editor.handleInput(data);
					refresh();
					return;
				}

				// Tab navigation (multi-question only).
				if (isMulti) {
					if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
						currentTab = (currentTab + 1) % totalTabs;
						optionIndex = 0;
						refresh();
						return;
					}
					if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
						currentTab = (currentTab - 1 + totalTabs) % totalTabs;
						optionIndex = 0;
						refresh();
						return;
					}
				}

				// n attaches a note — on a question tab or globally on the Review tab.
				if (data === "n" || data === "N") {
					if (currentTab === questions.length) {
						input = "global";
						editor.setText(model.globalNote ?? "");
					} else {
						input = "note";
						editor.setText(notes.get(questions[currentTab].id) ?? "");
					}
					refresh();
					return;
				}

				// Submit tab.
				if (currentTab === questions.length) {
					if (matchesKey(data, Key.enter) && model.complete) submit(false);
					else if (matchesKey(data, Key.escape)) submit(true);
					return;
				}

				// s marks a deliberate skip: counts toward Submit without answering.
				// On a skipped question it unskips; picking an option also unskips.
				if (data === "s" || data === "S") {
					const id = questions[currentTab].id;
					if (skipped.has(id)) {
						model.unskip(id);
						refresh();
					} else {
						model.skip(id);
						advanceAfterAnswer();
					}
					return;
				}

				const opts = renderOptionsFor(questions[currentTab]);

				// The whole point of this fork: number keys pick directly.
				if (/^[1-9]$/.test(data)) {
					pickOption(Number(data) - 1);
					return;
				}

				if (matchesKey(data, Key.up)) {
					optionIndex = Math.max(0, optionIndex - 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					optionIndex = Math.min(opts.length - 1, optionIndex + 1);
					refresh();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					pickOption(optionIndex);
					return;
				}
				if (matchesKey(data, Key.escape)) {
					submit(true);
				}
			}

			function render(width: number): string[] {
				if (cachedLines) return cachedLines;

				const onSubmitTab = currentTab === questions.length;
				const title = !isMulti ? "✦ Question" : onSubmitTab ? "✦ Review" : `✦ ${questions[currentTab].label}`;
				const box = makeChrome(theme, Math.max(20, width), title);
				const rows: string[] = [box.top];
				const q = questions[currentTab];
				const opts = q ? renderOptionsFor(q) : [];

				// Tab pills (multi-question only).
				if (isMulti) {
					const pills: string[] = [theme.fg("dim", "←")];
					for (let i = 0; i < questions.length; i++) {
						const isActive = i === currentTab;
						const isAnswered = answers.has(questions[i].id);
						const isSkipped = skipped.has(questions[i].id);
						const hasNote = notes.has(questions[i].id);
						const box_ = isAnswered ? "■" : isSkipped ? "⊘" : "□";
						const text = ` ${box_} ${questions[i].label}${hasNote ? "✎" : ""} `;
						pills.push(
							isActive
								? theme.bg("selectedBg", theme.fg("accent", theme.bold(text)))
								: theme.fg(isAnswered ? "success" : isSkipped ? "dim" : "muted", text),
						);
					}
					const isSubmitTab = currentTab === questions.length;
					const submitText = " ✓ Submit ";
					pills.push(
						isSubmitTab
							? theme.bg("selectedBg", theme.fg("accent", theme.bold(submitText)))
							: theme.fg(model.complete ? "success" : "dim", submitText),
					);
					pills.push(theme.fg("dim", "→"));
					rows.push(box.line(pills.join(" ")));
				}
				rows.push(box.line());

				function renderOptionList() {
					for (let i = 0; i < opts.length; i++) {
						const opt = opts[i];
						const selected = i === optionIndex;
						const editing = opt.isOther === true && input === "answer";

						const badge = theme.fg(selected ? "accent" : "dim", `${i + 1}`);
						const star = opt.recommended ? theme.fg("success", " ★") : "";
						const cursor = selected ? theme.fg("accent", "❯ ") : "  ";
						const name = `${badge}${theme.fg("dim", ".")} ${opt.label}${editing ? " ✎" : ""}${star}`;
						const labelLine = `${cursor}${selected ? theme.fg("accent", theme.bold(name)) : theme.fg("text", name)}`;

						if (selected) {
							// Full-width highlight for the selected row.
							for (const part of wrapTextWithAnsi(labelLine, box.inner)) {
								const pad = Math.max(0, box.inner - visibleWidth(part));
								rows.push(box.line(theme.bg("selectedBg", part + " ".repeat(pad))));
							}
						} else {
							rows.push(...box.wrapped(labelLine));
						}

						if (opt.description) {
							rows.push(...box.wrapped(theme.fg("muted", opt.description), "      "));
						}
					}
				}

				if (input !== null) {
					const inputLabel =
						input === "answer" ? "Your answer:" : input === "note" ? `Note on ${q?.label ?? ""}:` : "Global note (whole questionnaire):";
					if (input === "answer" && q) {
						rows.push(...box.wrapped(theme.bold(theme.fg("text", q.prompt))));
						rows.push(box.line());
						renderOptionList();
					} else if (input === "note" && q) {
						rows.push(...box.wrapped(theme.bold(theme.fg("text", q.prompt))));
					} else {
						rows.push(box.line(theme.fg("muted", "Attached to every answer in this questionnaire.")));
					}
					rows.push(box.line());
					rows.push(box.line(theme.fg("muted", inputLabel)));
					for (const line of editor.render(box.inner)) {
						rows.push(box.line(line));
					}
					rows.push(box.line());
					rows.push(box.line(rawKeyHint("enter", "save") + theme.fg("dim", "  ·  ") + rawKeyHint("esc", "discard")));
				} else if (currentTab === questions.length) {
					rows.push(box.line(theme.bold(theme.fg("accent", "Review your answers"))));
					rows.push(box.line());
					for (const question of questions) {
						const answer = answers.get(question.id);
						if (!answer) {
							if (skipped.has(question.id)) {
								rows.push(...box.wrapped(theme.fg("dim", `${question.label} → skipped`)));
							}
							continue;
						}
						const wrote = answer.wasCustom ? theme.fg("dim", "(wrote) ") : "";
						rows.push(
							...box.wrapped(
								`${theme.fg("accent", question.label)}${theme.fg("dim", " → ")}${wrote}${theme.fg("text", answer.label)}`,
							),
						);
						const note = notes.get(question.id);
						if (note) rows.push(...box.wrapped(theme.fg("dim", `✎ ${note}`), "    "));
					}
					if (model.globalNote) {
						rows.push(box.line());
						rows.push(...box.wrapped(theme.fg("dim", `✎ global: ${model.globalNote}`)));
					}
					rows.push(box.line());
					if (model.complete) {
						rows.push(box.line(theme.fg("success", "Enter to submit")));
					} else {
						const missing = questions
							.filter((question) => !answers.has(question.id) && !skipped.has(question.id))
							.map((question) => question.label)
							.join(", ");
						rows.push(...box.wrapped(theme.fg("warning", `Unanswered: ${missing}`)));
					}
				} else if (q) {
					rows.push(...box.wrapped(theme.bold(theme.fg("text", q.prompt))));
					rows.push(box.line());
					renderOptionList();
					if (skipped.has(q.id)) {
						rows.push(box.line());
						rows.push(...box.wrapped(theme.fg("dim", "⊘ skipped (s to unskip; picking an option also answers)"), "  "));
					}
					const note = notes.get(q.id);
					if (note) {
						rows.push(box.line());
						rows.push(...box.wrapped(theme.fg("dim", `✎ ${note.split("\n")[0]}`), "  "));
					}
				}

				rows.push(box.line());
				if (input === null) {
					const hints = isMulti
						? [rawKeyHint("1-9", "pick"), rawKeyHint("↑↓", "move"), rawKeyHint("tab", "switch"), rawKeyHint("n", "note"), rawKeyHint("s", "skip"), rawKeyHint("enter", "confirm"), rawKeyHint("esc", "dismiss")]
						: [rawKeyHint("1-9", "pick"), rawKeyHint("↑↓", "move"), rawKeyHint("n", "note"), rawKeyHint("s", "skip"), rawKeyHint("enter", "confirm"), rawKeyHint("esc", "dismiss")];
					rows.push(box.line(hints.join(theme.fg("dim", "  ·  "))));
				}
				rows.push(box.bottom);

				cachedLines = rows;
				return rows;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
				},
				handleInput,
			};
		},
	);
}

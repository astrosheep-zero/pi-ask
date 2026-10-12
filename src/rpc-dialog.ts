/** Consume replies from one native batch form. No extra review or note dialogs; skip is a row in each select. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Questionnaire, type AskResult, type Question } from "./state.ts";

type DialogUI = Pick<ExtensionContext["ui"], "select" | "input">;

export async function runRpcDialog(
	ui: DialogUI,
	questions: Question[],
	signal?: AbortSignal,
): Promise<AskResult> {
	const model = new Questionnaire(questions);
	const options = { signal };
	for (const q of questions) {
		if (signal?.aborted) return model.cancel();
		const labels = q.options.map((option, index) => `${index + 1}. ${option.label} — ${option.description ?? ""}`);
		const other = `${labels.length + 1}. Type something.`;
		const skip = `${labels.length + 2}. Skip this question`;
		// The host captures the entire questionnaire at tool start. These requests
		// are answered from its one submitted form, not shown as separate cards.
		const selected = await ui.select(q.prompt, [...labels, other, skip], options);
		if (signal?.aborted || selected === undefined) return model.cancel();
		if (selected === skip) {
			model.skip(q.id);
		} else if (selected === other) {
			const text = await ui.input(q.prompt, "Your answer", options);
			if (signal?.aborted || text === undefined) return model.cancel();
			model.write(q.id, text);
		} else {
			const index = labels.indexOf(selected);
			if (index < 0) throw new Error("UI returned an unknown answer option");
			model.select(q.id, index);
		}
	}
	return model.submit();
}

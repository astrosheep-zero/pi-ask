/** Choose the UI transport once; both renderers use the same questionnaire semantics. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAskDialog } from "./dialog.ts";
import { runRpcDialog } from "./rpc-dialog.ts";
import { type AskResult, type Question, Questionnaire } from "./state.ts";

export function supportsQuestionnaire(ctx: Pick<ExtensionContext, "mode" | "hasUI">): boolean {
	return ctx.hasUI && (ctx.mode === "tui" || ctx.mode === "rpc");
}

export async function runQuestionnaire(
	ctx: ExtensionContext,
	questions: Question[],
	signal = ctx.signal,
): Promise<AskResult> {
	if (!supportsQuestionnaire(ctx)) throw new Error("A terminal or RPC UI client is required");
	if (signal?.aborted) return new Questionnaire(questions).cancel();
	return ctx.mode === "tui"
		? runAskDialog(ctx, questions)
		: runRpcDialog(ctx.ui, questions, signal);
}

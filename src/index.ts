/**
 * pi-ask — ask_user tool: a tabbed question dialog for the model to ask the human.
 *
 * Commands:
 *   /ask [on|off|status]  toggle the tool (persisted to ~/.config/pi-ask/config.json)
 *   /ask demo            preview the dialog with sample questions
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isAskEnabled, loadConfig, saveConfig } from "./config.ts";
import { runQuestionnaire, supportsQuestionnaire } from "./interaction.ts";
import { AskUserParams } from "./schema.ts";
import { BATCH_TOOL, BatchParams, normalizeBatch, batchDetails } from "./batch.ts";
import {
	buildSummaryText,
	errorResult,
	normalizeQuestions,
	type AskResult,
	type Question,
	type RawQuestion,
} from "./state.ts";

const TOOL = "ask_user";

const TOOL_DESCRIPTION = `Ask the user one or more questions (1-4) in one questionnaire (tabbed terminal dialog). Use when a decision is ambiguous, expensive to reverse, or depends on a preference you cannot infer from the code or docs. Each question needs 2-6 concrete options; mark one as recommended when you have a best guess. Batch related questions into ONE call instead of asking sequentially. Do NOT use this for things you can determine yourself. The user may skip any question; treat skipped questions as delegated back to your best judgment.`;

const DEMO_QUESTIONS: RawQuestion[] = [
	{
		id: "approach",
		label: "Approach",
		prompt: "Which caching strategy should the API client use?",
		options: [
			{ value: "memory", label: "In-memory LRU", description: "Fast, simple, lost on restart", recommended: true },
			{ value: "redis", label: "Redis", description: "Shared across processes, adds an infra dependency" },
			{ value: "disk", label: "Disk cache", description: "Survives restarts, slower, needs cleanup" },
		],
	},
	{
		id: "ttl",
		label: "TTL",
		prompt: "Default TTL for cache entries?",
		options: [
			{ value: "60", label: "1 minute" },
			{ value: "300", label: "5 minutes", recommended: true },
			{ value: "3600", label: "1 hour" },
		],
	},
];

export default function piAsk(pi: ExtensionAPI) {
	let enabled = isAskEnabled(loadConfig());
	let activeTool = TOOL;

	function applyToolState() {
		const active = new Set(pi.getActiveTools());
		active.delete(TOOL);
		active.delete(BATCH_TOOL);
		if (enabled) active.add(activeTool);
		pi.setActiveTools([...active]);
	}

	pi.on("session_start", async (_event, ctx) => {
		activeTool = ctx.mode === "rpc" ? BATCH_TOOL : TOOL;
		applyToolState();
	});

	pi.registerTool({
		name: TOOL,
		label: "Ask User",
		description: TOOL_DESCRIPTION,
		parameters: AskUserParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!enabled) {
				return errorResult(`${TOOL} is disabled. Use /ask on to enable it; ask in plain chat text if you must, or proceed with your best judgment.`);
			}
			if (!ctx.hasUI || ctx.mode !== "tui") {
				return errorResult(`Use ${BATCH_TOOL} in RPC mode; ${TOOL} is the terminal interface.`);
			}

			let questions: Question[];
			try {
				questions = normalizeQuestions(params.questions);
			} catch (err) {
				return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
			}

			const result = await runQuestionnaire(ctx, questions, signal ?? ctx.signal);
			if (result.cancelled) {
				return {
					content: [
						{
							type: "text",
							text: "User dismissed the dialog without answering. Do not re-ask the same questions; proceed with your best judgment and state your assumptions, or continue with other work.",
						},
					],
					details: result,
				};
			}
			return {
				content: [{ type: "text", text: buildSummaryText(questions, result.answers, result.notes, result.globalNote, result.skipped) }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const qs = Array.isArray(args.questions) ? args.questions : [];
			let text = theme.fg("toolTitle", theme.bold(`${TOOL} `));
			text += theme.fg("muted", `${qs.length} question${qs.length === 1 ? "" : "s"}`);
			const labels = qs.map((q, i) => q.label || `Q${i + 1}`).join(", ");
			if (labels) text += theme.fg("dim", ` (${labels})`);
			for (const q of qs) {
				if (q?.prompt) text += `\n${theme.fg("muted", `  ${q.prompt}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as AskResult | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "Dismissed"), 0, 0);
			}
			const lines = details.answers.map((a) => {
				const head = `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}${theme.fg("muted", ": ")}`;
				const noted = details.notes.some((n) => n.id === a.id) ? theme.fg("dim", " ✎") : "";
				if (a.wasCustom) return head + theme.fg("muted", "(wrote) ") + a.label + noted;
				return head + (a.index ? `${a.index}. ` : "") + a.label + noted;
			});
			for (const id of details.skipped) {
				lines.push(theme.fg("dim", `⊘ ${id}: skipped`));
			}
			if (details.globalNote) lines.push(theme.fg("dim", `✎ global note: ${details.globalNote}`));
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: BATCH_TOOL,
		label: "Ask User",
		description: "Ask 1–4 related questions in ONE questionnaire. Use for decisions requiring user input, not facts you can check yourself. Each question has 2–4 distinct options with descriptions; a custom answer is always available. Use unique question texts and short unique tab headers. The user can switch tabs and edit before submitting once, and may skip any question; treat skipped questions as delegated back to your best judgment. Do not ask a separate confirmation or global-note question afterward.",
		parameters: BatchParams,
		executionMode: "sequential",
		async execute(_id, params, signal, _update, ctx) {
			if (!enabled) throw new Error("Ask User is off. Use /ask on to enable it.");
			if (!ctx.hasUI || ctx.mode !== "rpc") throw new Error(`${BATCH_TOOL} requires an RPC UI client`);
			const questions = normalizeBatch(params.questions);
			const result = await runQuestionnaire(ctx, questions, signal ?? ctx.signal);
			return {
				content: [{ type: "text", text: result.cancelled
					? "User dismissed the questionnaire. Do not re-ask the same questions; continue with other work or state your assumptions."
					: buildSummaryText(questions, result.answers, [], undefined, result.skipped) }],
				details: batchDetails(result),
			};
		},
	});

	pi.registerCommand("ask", {
		description: "Ask User: /ask [on|off|status|demo]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "" || arg === "on" || arg === "off") {
				enabled = arg === "" ? !enabled : arg === "on";
				saveConfig({ enabled });
				applyToolState();
				ctx.ui.notify(`Ask User ${enabled ? "enabled" : "disabled"} (persisted)`, "info");
				return;
			}
			if (arg === "status") {
				ctx.ui.notify(`Ask User is ${enabled ? "ON" : "OFF"} — /ask to toggle`, "info");
				return;
			}
			if (arg !== "demo") {
				ctx.ui.notify(`Unknown argument "${arg}" — use /ask [on|off|status|demo]`, "warning");
				return;
			}
			if (!supportsQuestionnaire(ctx)) {
				ctx.ui.notify("/ask demo requires a terminal or RPC UI client", "error");
				return;
			}
			if (ctx.mode === "rpc") {
				if (!enabled) {
					ctx.ui.notify("Run /ask on first, then /ask demo.", "info");
					return;
				}
				// The host adapter correlates tool_execution_start with UI requests.
				// Calling dialogs directly from a command would preview the wrong UI.
				const questions = DEMO_QUESTIONS.map(q => ({
					header: q.label ?? q.id,
					question: q.prompt,
					options: q.options.map(option => ({ label: option.label, description: `${option.recommended ? "Recommended. " : ""}${option.description ?? ""}` })),
				}));
				pi.sendUserMessage(`Run this ${BATCH_TOOL} demo once using these exact arguments; this is a UI preview, not a project decision:\n${JSON.stringify({ questions })}`);
				return;
			}
			const questions = normalizeQuestions(DEMO_QUESTIONS);
			const result = await runQuestionnaire(ctx, questions);
			ctx.ui.notify(
				result.cancelled ? "Dismissed" : buildSummaryText(questions, result.answers, result.notes, result.globalNote),
				"info",
			);
		},
	});
}

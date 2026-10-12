/** Opt-in integration against the host's actual adapter, not a copied implementation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { BATCH_TOOL, normalizeBatch, batchDetails } from "../src/batch.ts";
import { runRpcDialog } from "../src/rpc-dialog.ts";

const root = process.env.PASEO_SOURCE;
test("unchanged Paseo renders one batch permission and caches every subsequent dialog reply", { skip: !root }, async () => {
	const { rpivAskUserQuestion } = await import(pathToFileURL(join(root!,
		"packages/server/src/server/agent/providers/pi/extensions/rpiv-ask-user-question/index.ts")).href);
	const questions = [
		{ header: "Scope", question: "How much?", options: [{ label: "Small", description: "Minimal" }, { label: "Large", description: "All" }] },
		{ header: "Tests", question: "Which tests?", options: [{ label: "Fast", description: "Smoke" }, { label: "Full", description: "Suite" }] },
	];
	for (const cancelled of [false, true]) {
		const host = rpivAskUserQuestion.createSession();
		const call = { callId: "test", toolName: BATCH_TOOL, args: { questions }, status: "running", result: null };
		const permission = host.onToolStart(call, "pi");
		assert.equal(permission.kind, "question");
		assert.equal(permission.input.questions.length, 2);
		assert.ok(permission.input.questions.every((q: { allowOther: boolean }) => q.allowOther));
		let count = 0;
		async function dialog(method: string, title: string, options?: string[]) {
			const request = { type: "extension_ui_request", id: String(++count), method, title, options };
			const mapped = host.mapDialog(request, "pi");
			let response;
			if (count === 1) {
				assert.equal(mapped.type, "deferred");
				const submitted = host.respondToPermission(permission, cancelled ? { behavior: "deny" } : {
					behavior: "allow", updatedInput: { answers: { Scope: "Large", Tests: "Just this case" } },
				});
				assert.equal(submitted.responses.length, 1);
				assert.equal(submitted.responses[0].id, request.id);
				response = submitted.responses[0].response;
			} else {
				// No permission mapping and no generic fallback: no second card.
				assert.equal(mapped.type, "response");
				response = mapped.response;
			}
			return response.cancelled ? undefined : response.value;
		}
		const result = await runRpcDialog({
			select: (title, options) => dialog("select", title, options),
			input: title => dialog("input", title),
		}, normalizeBatch(questions));
		assert.equal(result.cancelled, cancelled);
		assert.equal(count, cancelled ? 1 : 3); // two select replies + one inline custom answer
		const details = batchDetails(result);
		if (!cancelled) {
			assert.deepEqual(result.answers.map(a => a.value), ["Large", "Just this case"]);
			const mapped = host.mapToolCall({ ...call, status: "completed", result: { details } });
			assert.equal(mapped.detail.text, "How much?: Large\nWhich tests?: Just this case");
		}
		host.onToolEnd(call);
	}
});

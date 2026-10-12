import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piAsk from "../src/index.ts";

test("session mode exposes one tool; commands toggle it and demo uses the batch contract", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-ask-test-"));
	const previous = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = directory;
	try {
		mkdirSync(join(directory, "pi-ask"));
		writeFileSync(join(directory, "pi-ask/config.json"), '{"enabled":true}');
		let active: string[] = ["read"];
		let start: (event: unknown, ctx: ExtensionContext) => Promise<void>;
		const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
		const messages: string[] = [];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => { active = names; },
			registerTool: (tool: { name: string }) => { active.push(tool.name); },
			registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) => commands.set(name, command),
			on: (_event: string, handler: typeof start) => { start = handler; },
			sendUserMessage: (message: string) => { messages.push(message); },
		} as unknown as ExtensionAPI;
		piAsk(pi);
		const rpc = { mode: "rpc", hasUI: true, ui: { notify() {} } } as unknown as ExtensionContext;
		await start!({}, rpc);
		assert.deepEqual(active, ["read", "ask_user_question"]);
		const ask = commands.get("ask")!;
		assert.equal(commands.size, 1);
		await ask.handler("demo", rpc as never);
		assert.equal(messages.length, 1);
		assert.match(messages[0], /ask_user_question demo/);
		const args = JSON.parse(messages[0].split("\n")[1]);
		assert.equal(args.questions.length, 2);
		assert.ok(args.questions.every((q: { header: string; question: string }) => q.header && q.question));
		assert.equal("allowComment" in args, false);
		await ask.handler("off", rpc as never);
		assert.deepEqual(active, ["read"]);
		await ask.handler("demo", rpc as never);
		assert.equal(messages.length, 1);
		await ask.handler("on", rpc as never);
		assert.deepEqual(active, ["read", "ask_user_question"]);
		await start!({}, { ...rpc, mode: "tui" });
		assert.deepEqual(active, ["read", "ask_user"]);
	} finally {
		if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previous;
		rmSync(directory, { recursive: true, force: true });
	}
});

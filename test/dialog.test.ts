import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { runAskDialog } from "../src/dialog.ts";

initTheme("dark", false);
const theme = { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s };
function mount() {
	let component: any;
	const result = runAskDialog({ ui: { custom(factory: any) {
		return new Promise(resolve => {
			component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, resolve);
			component.focused = true;
		});
	} } } as any, [{ id: "q", label: "Scope", prompt: "选择范围？", allowOther: true,
		options: [{ value: "a", label: "Small" }, { value: "b", label: "Large" }] }]);
	return { component, result, lines: (width = 72) => component.render(width).map(stripTerminalSequences) as string[] };
}

test("custom answer requires Enter, occupies the same row, and preserves input shortcuts as text", async () => {
	const { component: c, result, lines } = mount();
	c.handleInput("3");
	const before = lines();
	const row = before.findIndex(l => l.includes("Type something."));
	c.handleInput("x"); // no type-to-type
	assert.deepEqual(lines(), before);
	c.handleInput("\r");
	c.handleInput("中文 n s 123");
	assert.match(lines()[row], /中文 n s 123/);
	assert.equal(lines().filter(l => /^─+$/.test(l)).length, 1);
	assert.ok(c.render(72).some((l: string) => l.includes(CURSOR_MARKER)));
	c.handleInput("\r");
	assert.equal((await result).answers[0].value, "中文 n s 123");
});

test("Esc discards editing without dismissing; resizing wraps hints and multiline input", async () => {
	const { component: c, result, lines } = mount();
	c.handleInput("3"); c.handleInput("\r");
	c.handleInput("\x1b[200~first line\nsecond line\x1b[201~");
	assert.ok(lines().some(l => l.includes("second line")));
	for (const line of lines(32)) assert.ok(visibleWidth(line) <= 32, line);
	c.handleInput("\x1b");
	assert.ok(lines().some(l => l.includes("Type something.")));
	c.handleInput("1");
	assert.equal((await result).answers[0].value, "a");
});

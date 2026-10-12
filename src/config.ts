/**
 * Config file: ~/.config/pi-ask/config.json (respects XDG_CONFIG_HOME).
 * Read + written by the /ask toggle command.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AskConfig {
	/** Whether the ask_user tool is exposed to the model. Default: false. */
	enabled?: boolean;
}

export function isAskEnabled(config: AskConfig): boolean {
	return config.enabled ?? false;
}

/** Pure parse — malformed input degrades to defaults, never throws. */
export function parseConfig(text: string): AskConfig {
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null) return {};
		const cfg = parsed as Record<string, unknown>;
		return { enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : undefined };
	} catch {
		return {};
	}
}

function configPath(): string {
	const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "pi-ask", "config.json");
}

export function loadConfig(): AskConfig {
	try {
		const p = configPath();
		if (!existsSync(p)) return {};
		return parseConfig(readFileSync(p, "utf8"));
	} catch {
		return {};
	}
}

export function saveConfig(patch: AskConfig): void {
	const p = configPath();
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, `${JSON.stringify({ ...loadConfig(), ...patch }, null, 2)}\n`);
}

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text } from "@mariozechner/pi-tui";

const CODEX_PROVIDER = "openai-codex";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 15_000;
const BAR_SEGMENTS = 20;

type OAuthCredential = {
	type?: string;
	access?: string;
	accountId?: string;
};

type RateLimitWindow = {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_after_seconds?: number;
	reset_at?: number;
};

type RateLimitDetails = {
	allowed?: boolean;
	limit_reached?: boolean;
	primary_window?: RateLimitWindow | null;
	secondary_window?: RateLimitWindow | null;
};

type CreditsDetails = {
	has_credits?: boolean;
	unlimited?: boolean;
	balance?: string | null;
};

type AdditionalRateLimit = {
	limit_name?: string;
	metered_feature?: string;
	rate_limit?: RateLimitDetails | null;
};

type UsagePayload = {
	plan_type?: string;
	rate_limit?: RateLimitDetails | null;
	credits?: CreditsDetails | null;
	additional_rate_limits?: AdditionalRateLimit[] | null;
	rate_limit_reached_type?: { type?: string } | null;
};

type LimitGroup = {
	name: string;
	rateLimit?: RateLimitDetails | null;
};

function decodeBase64Url(input: string): string {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	return Buffer.from(padded, "base64").toString("utf8");
}

function extractAccountId(token: string): string | undefined {
	try {
		const [, payload] = token.split(".");
		if (!payload) return undefined;
		const decoded = JSON.parse(decodeBase64Url(payload));
		return decoded?.["https://api.openai.com/auth"]?.chatgpt_account_id;
	} catch {
		return undefined;
	}
}

function planName(planType?: string): string {
	if (!planType) return "unknown";
	return planType
		.split("_")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function durationLabel(seconds?: number): string {
	if (!seconds || seconds <= 0) return "limit";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = minutes / 60;
	if (Number.isInteger(hours) && hours < 24) return `${hours}h`;
	const days = hours / 24;
	if (Math.abs(days - 7) < 0.01) return "Weekly";
	if (Math.abs(days - 30) < 1) return "Monthly";
	if (Number.isInteger(days)) return `${days}d`;
	return `${Math.round(hours)}h`;
}

function resetLabel(window: RateLimitWindow): string | undefined {
	const resetAt = window.reset_at;
	if (typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > 0) {
		const date = new Date(resetAt * 1000);
		const time = new Intl.DateTimeFormat(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(date);
		const now = new Date();
		if (date.toDateString() === now.toDateString()) return time;
		const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
		return `${time} on ${day}`;
	}

	const resetAfter = window.reset_after_seconds;
	if (typeof resetAfter !== "number" || !Number.isFinite(resetAfter) || resetAfter < 0) {
		return undefined;
	}
	const minutes = Math.round(resetAfter / 60);
	if (minutes < 60) return `in ${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `in ${hours}h`;
	return `in ${Math.round(hours / 24)}d`;
}

function progressBar(percentRemaining: number): string {
	const ratio = Math.max(0, Math.min(1, percentRemaining / 100));
	const filled = Math.min(BAR_SEGMENTS, Math.round(ratio * BAR_SEGMENTS));
	return `[${"█".repeat(filled)}${"░".repeat(BAR_SEGMENTS - filled)}]`;
}

function formatWindow(window: RateLimitWindow): string {
	const used = typeof window.used_percent === "number" ? window.used_percent : 0;
	const remaining = Math.max(0, Math.min(100, 100 - used));
	const reset = resetLabel(window);
	return `${progressBar(remaining)} ${remaining.toFixed(0)}% left${reset ? ` (resets ${reset})` : ""}`;
}

function formatLimitGroup(group: LimitGroup): string[] {
	const lines: string[] = [];
	const primary = group.rateLimit?.primary_window ?? undefined;
	const secondary = group.rateLimit?.secondary_window ?? undefined;

	if (group.name !== "Codex") {
		lines.push(`${group.name} limit:`);
	}

	if (primary) {
		const label = durationLabel(primary.limit_window_seconds);
		lines.push(`  ${label} limit: ${formatWindow(primary)}`);
	}
	if (secondary) {
		const label = durationLabel(secondary.limit_window_seconds);
		lines.push(`  ${label} limit: ${formatWindow(secondary)}`);
	}
	if (!primary && !secondary) {
		lines.push(`  Limits: not available for ${group.name}`);
	}
	return lines;
}

function formatCredits(credits?: CreditsDetails | null): string[] {
	if (!credits?.has_credits) return [];
	if (credits.unlimited) return ["Credits: Unlimited"];
	const rawBalance = credits.balance?.trim();
	if (!rawBalance) return [];
	const parsed = Number(rawBalance);
	const display = Number.isFinite(parsed) ? Math.round(parsed).toString() : rawBalance;
	return [`Credits: ${display}`];
}

function formatUsage(payload: UsagePayload): string {
	const lines = ["Codex usage status", ""];
	lines.push(`Plan: ${planName(payload.plan_type)}`);
	lines.push(...formatCredits(payload.credits));
	if (payload.rate_limit_reached_type?.type) {
		lines.push(`Limit state: ${payload.rate_limit_reached_type.type}`);
	}
	lines.push("");

	const groups: LimitGroup[] = [{ name: "Codex", rateLimit: payload.rate_limit }];
	for (const additional of payload.additional_rate_limits ?? []) {
		groups.push({
			name: additional.limit_name || additional.metered_feature || "Additional",
			rateLimit: additional.rate_limit,
		});
	}

	let wroteAnyLimit = false;
	for (const group of groups) {
		const groupLines = formatLimitGroup(group);
		if (groupLines.length > 0) {
			if (wroteAnyLimit) lines.push("");
			lines.push(...groupLines);
			wroteAnyLimit = true;
		}
	}

	lines.push("");
	lines.push(`Source: ${CODEX_USAGE_URL}`);
	return lines.join("\n");
}

async function getCodexToken(ctx: ExtensionCommandContext): Promise<{ token: string; accountId?: string }> {
	const model =
		ctx.modelRegistry.find(CODEX_PROVIDER, "gpt-5.3-codex-spark") ??
		ctx.modelRegistry.find(CODEX_PROVIDER, "gpt-5.5") ??
		ctx.modelRegistry.getAll().find((candidate) => candidate.provider === CODEX_PROVIDER);
	if (!model) {
		throw new Error("No openai-codex model is registered in pi.");
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(auth.error);
	}
	if (!auth.apiKey) {
		throw new Error("No ChatGPT/Codex OAuth token found. Run /login and choose OpenAI ChatGPT (Codex).");
	}

	const storage = ctx.modelRegistry.authStorage as { get?: (provider: string) => OAuthCredential | undefined };
	const stored = storage.get?.(CODEX_PROVIDER);
	const accountId = stored?.accountId || extractAccountId(auth.apiKey);
	return { token: auth.apiKey, accountId };
}

async function fetchUsage(ctx: ExtensionCommandContext): Promise<UsagePayload> {
	const { token, accountId } = await getCodexToken(ctx);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			originator: "pi",
			"User-Agent": "pi codex-status",
			accept: "application/json",
		};
		if (accountId) {
			headers["chatgpt-account-id"] = accountId;
		}

		const response = await fetch(CODEX_USAGE_URL, {
			method: "GET",
			headers,
			signal: controller.signal,
		});
		const body = await response.text();
		if (!response.ok) {
			throw new Error(`GET ${CODEX_USAGE_URL} failed: ${response.status} ${response.statusText}\n${body}`);
		}
		return JSON.parse(body) as UsagePayload;
	} finally {
		clearTimeout(timeout);
	}
}

async function showUsage(content: string, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		console.log(content);
		return;
	}

	await ctx.ui.custom((_tui, theme, _keybindings, done) => {
		const [title, ...rest] = content.split("\n");
		const body = `${theme.fg("accent", theme.bold(title))}\n${rest.join("\n")}\n\n${theme.fg("dim", "Press Enter or Esc to close")}`;
		const text = new Text(body, 0, 0);

		return {
			render: (width: number) => text.render(width),
			invalidate: () => text.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("codex-status", {
		description: "Fetch ChatGPT Codex usage limits from the Codex backend",
		handler: async (_args, ctx) => {
			try {
				const payload = await fetchUsage(ctx);
				await showUsage(formatUsage(payload), ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) {
					ctx.ui.notify(`Codex usage fetch failed: ${message}`, "error");
				} else {
					console.error(`Codex usage fetch failed: ${message}`);
				}
			}
		},
	});
}

import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const PROVIDER = "openai-codex";
const MODEL = "gpt-5.6-terra";
const WIDGET_ID = "technical-communication";

const SYSTEM_PROMPT = `Rewrite the user's message as two principal software engineers would naturally communicate it. Optimize for precision and shared understanding, not impressive jargon. Preserve the user's intent and level of certainty. Never invent evidence, causality, requirements, architecture, or guarantees.

Return only the rewritten message. Do not add a heading, explanation, commentary, quotation marks, or alternatives. Keep it concise and suitable for the apparent context.`;

type CoachState = {
	controller?: AbortController;
	requestId: number;
};

function showWidget(ctx: ExtensionContext, markdown?: string): void {
	if (ctx.mode !== "tui") return;

	if (!markdown) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}

	ctx.ui.setWidget(
		WIDGET_ID,
		(_tui, theme) => new Text(theme.fg("mdLink", markdown), 1, 0),
		{ placement: "belowEditor" },
	);
}

export default function technicalCommunicationExtension(pi: ExtensionAPI) {
	const state: CoachState = { requestId: 0 };

	pi.on("session_start", (_event, ctx) => {
		showWidget(ctx);
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension" || !event.text.trim()) {
			return { action: "continue" };
		}

		state.controller?.abort();
		const controller = new AbortController();
		state.controller = controller;
		const requestId = ++state.requestId;

		if (ctx.hasUI) ctx.ui.setStatus(WIDGET_ID, "rephrasing…");

		void (async () => {
			const model = ctx.modelRegistry.find(PROVIDER, MODEL);
			if (!model) {
				if (ctx.hasUI) {
					ctx.ui.setStatus(WIDGET_ID, undefined);
					ctx.ui.notify(`Model ${PROVIDER}/${MODEL} is unavailable.`, "warning");
				}
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				const reason = auth.ok ? `No credentials for ${PROVIDER}.` : auth.error;
				if (ctx.hasUI) {
					ctx.ui.setStatus(WIDGET_ID, undefined);
					ctx.ui.notify(reason, "warning");
				}
				return;
			}

			const message: UserMessage = {
				role: "user",
				content: [{ type: "text", text: event.text }],
				timestamp: Date.now(),
			};

			const response = await complete(
				model,
				{ systemPrompt: SYSTEM_PROMPT, messages: [message] },
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					env: auth.env,
					reasoningEffort: "none",
					signal: controller.signal,
				},
			);

			if (controller.signal.aborted || requestId !== state.requestId) return;

			const markdown = response.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();

			if (ctx.hasUI) ctx.ui.setStatus(WIDGET_ID, undefined);
			showWidget(ctx, markdown || undefined);
		})().catch((error: unknown) => {
			if (controller.signal.aborted || requestId !== state.requestId) return;
			if (ctx.hasUI) {
				ctx.ui.setStatus(WIDGET_ID, undefined);
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Coach unavailable: ${message}`, "warning");
			}
		});

		return { action: "continue" };
	});

	pi.on("session_shutdown", (_event, ctx) => {
		state.controller?.abort();
		if (ctx.hasUI) ctx.ui.setStatus(WIDGET_ID, undefined);
	});
}

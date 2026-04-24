import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type TextBlock = { type?: string; text?: string };
type MessageLike = { role?: unknown; content?: unknown };

type Session = {
	id: string;
	title: string;
	kind: "last" | "file";
	sourcePath?: string;
	markdownPath: string;
};

type SubmittedAnnotation = {
	quote?: string;
	comment?: string;
};

type SubmitPayload = {
	id?: string;
	annotations?: SubmittedAnnotation[];
	globalComment?: string;
};

declare const __dirname: string;

const sessions = new Map<string, Session>();
let server: ReturnType<typeof createServer> | null = null;
let serverPort: number | null = null;

function projectDir(ctx: ExtensionCommandContext): string {
	return join(ctx.cwd, ".pi", "annotator-lite", "sessions");
}

function safeName(input: string): string {
	return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "doc";
}

function isAssistantMessage(message: MessageLike): message is { role: "assistant"; content: TextBlock[] } {
	return message.role === "assistant" && Array.isArray(message.content);
}

function textFromAssistant(message: { content: TextBlock[] }): string {
	return message.content
		.filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n\n")
		.trim();
}

function lastAssistantText(ctx: ExtensionCommandContext): string | null {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; message?: MessageLike };
		if (entry.type !== "message" || !entry.message || !isAssistantMessage(entry.message)) continue;
		const text = textFromAssistant(entry.message);
		if (text) return text;
	}
	return null;
}

function writeSession(ctx: ExtensionCommandContext, opts: { title: string; kind: "last" | "file"; markdown: string; sourcePath?: string }): Session {
	const dir = projectDir(ctx);
	mkdirSync(dir, { recursive: true });
	const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
	const markdownPath = join(dir, `${safeName(opts.title)}-${id}.md`);
	writeFileSync(markdownPath, opts.markdown, "utf8");
	const session: Session = { id, title: opts.title, kind: opts.kind, sourcePath: opts.sourcePath, markdownPath };
	writeFileSync(join(dir, `${id}.json`), JSON.stringify(session, null, 2), "utf8");
	sessions.set(id, session);
	return session;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolveBody, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 2_000_000) {
				req.destroy();
				reject(new Error("Request body too large"));
			}
		});
		req.on("end", () => resolveBody(body));
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(value));
}

function sendText(res: ServerResponse, text: string, contentType = "text/plain; charset=utf-8"): void {
	res.writeHead(200, { "content-type": contentType });
	res.end(text);
}

function buildFeedback(session: Session, payload: SubmitPayload): string {
	const annotations = (payload.annotations ?? [])
		.map((a) => ({ quote: (a.quote ?? "").trim(), comment: (a.comment ?? "").trim() }))
		.filter((a) => a.quote || a.comment);
	const globalComment = (payload.globalComment ?? "").trim();
	const source = session.kind === "file" && session.sourcePath ? `file ${session.sourcePath}` : "your previous response";
	const lines = [`I annotated ${source}. Please address this feedback:`];

	annotations.forEach((annotation, index) => {
		lines.push("", `${index + 1}. Regarding:`);
		if (annotation.quote) {
			lines.push(...annotation.quote.split("\n").map((line) => `> ${line}`));
		} else {
			lines.push("> [no exact quote captured]");
		}
		if (annotation.comment) lines.push("", "Comment:", annotation.comment);
	});

	if (globalComment) lines.push("", "Global feedback:", globalComment);
	return lines.join("\n").trim();
}

function startServer(pi: ExtensionAPI): Promise<number> {
	if (server && serverPort) return Promise.resolve(serverPort);
	const uiPath = join(__dirname, "ui.html");
	server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method === "GET" && url.pathname === "/") {
				sendText(res, readFileSync(uiPath, "utf8"), "text/html; charset=utf-8");
				return;
			}
			if (req.method === "GET" && url.pathname === "/styles.css") {
				sendText(res, readFileSync(join(__dirname, "styles.css"), "utf8"), "text/css; charset=utf-8");
				return;
			}
			if (req.method === "GET" && url.pathname === "/app.js") {
				sendText(res, readFileSync(join(__dirname, "app.js"), "utf8"), "application/javascript; charset=utf-8");
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/doc") {
				const id = url.searchParams.get("id") ?? "";
				const session = sessions.get(id);
				if (!session) return sendJson(res, { error: "Unknown session" }, 404);
				sendJson(res, {
					id: session.id,
					title: session.title,
					kind: session.kind,
					sourcePath: session.sourcePath,
					markdown: readFileSync(session.markdownPath, "utf8"),
				});
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/submit") {
				const payload = JSON.parse(await readBody(req)) as SubmitPayload;
				const session = payload.id ? sessions.get(payload.id) : undefined;
				if (!session) return sendJson(res, { error: "Unknown session" }, 404);
				const feedback = buildFeedback(session, payload);
				if (feedback) pi.sendUserMessage(feedback);
				sendJson(res, { ok: true });
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/close") {
				sendJson(res, { ok: true });
				return;
			}
			sendJson(res, { error: "Not found" }, 404);
		} catch (err) {
			sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
		}
	});
	return new Promise((resolvePort) => {
		server!.listen(0, "127.0.0.1", () => {
			const address = server!.address();
			const port = typeof address === "object" && address ? address.port : 0;
			serverPort = port;
			resolvePort(port);
		});
	});
}

function openBrowser(url: string): void {
	const platform = process.platform;
	if (platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
	else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
	else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function openSession(pi: ExtensionAPI, ctx: ExtensionCommandContext, session: Session): Promise<void> {
	const port = await startServer(pi);
	openBrowser(`http://127.0.0.1:${port}/?id=${encodeURIComponent(session.id)}`);
	ctx.ui.notify(`Annotator opened: ${session.title}`, "info");
}

function resolveUserPath(ctx: ExtensionCommandContext, input: string): string {
	const cleaned = input.trim().replace(/^@/, "");
	return resolve(ctx.cwd, cleaned);
}

export default function annotatorLite(pi: ExtensionAPI): void {
	pi.on("session_shutdown", async () => {
		server?.close();
		server = null;
		serverPort = null;
		sessions.clear();
	});

	pi.registerCommand("annotate-last", {
		description: "Open the last assistant message in a minimal browser annotator",
		handler: async (_args, ctx) => {
			const markdown = lastAssistantText(ctx);
			if (!markdown) {
				ctx.ui.notify("No assistant text message found.", "warning");
				return;
			}
			const session = writeSession(ctx, { title: "last-response", kind: "last", markdown });
			await openSession(pi, ctx, session);
		},
	});

	pi.registerCommand("annotate-file", {
		description: "Open a markdown/text file in a minimal browser annotator",
		handler: async (args, ctx) => {
			const inputPath = args.trim();
			if (!inputPath) {
				ctx.ui.setEditorText("/annotate-file ");
				ctx.ui.notify("Pick a file after /annotate-file, then submit again.", "info");
				return;
			}
			const filePath = resolveUserPath(ctx, inputPath);
			let markdown: string;
			try {
				markdown = readFileSync(filePath, "utf8");
			} catch (err) {
				ctx.ui.notify(`Could not read file: ${err instanceof Error ? err.message : String(err)}`, "error");
				return;
			}
			const session = writeSession(ctx, {
				title: safeName(filePath.split(/[\\/]/).pop() ?? "file"),
				kind: "file",
				markdown,
				sourcePath: filePath,
			});
			await openSession(pi, ctx, session);
		},
	});
}

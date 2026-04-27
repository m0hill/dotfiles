import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

declare const __dirname: string;

type ReviewMode = "worktree" | "commit" | "base";
type ReviewSession = { id: string; title: string; mode: ReviewMode; patchPath: string; commit?: string; base?: string };
type Annotation = { file?: string; scope?: "lines" | "file"; side?: string; start?: number; end?: number; quote?: string; comment?: string };
type FeedbackPayload = { id?: string; annotations?: Annotation[]; globalComment?: string };
type AskPayload = { id?: string; file?: string; scope?: "lines" | "file"; side?: string; start?: number; end?: number; quote?: string; question?: string };

const sessions = new Map<string, ReviewSession>();
let server: ReturnType<typeof createServer> | null = null;
let serverPort: number | null = null;

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
	if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
	return result.stdout;
}

function projectDir(ctx: ExtensionCommandContext): string {
	return join(ctx.cwd, ".pi-cache", "review-lite", "sessions");
}

function writeSession(ctx: ExtensionCommandContext, opts: { title: string; mode: ReviewMode; patch: string; commit?: string; base?: string }): ReviewSession {
	const dir = projectDir(ctx);
	mkdirSync(dir, { recursive: true });
	const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
	const patchPath = join(dir, `${id}.patch`);
	writeFileSync(patchPath, opts.patch, "utf8");
	const session: ReviewSession = { id, title: opts.title, mode: opts.mode, patchPath, commit: opts.commit, base: opts.base };
	writeFileSync(join(dir, `${id}.json`), JSON.stringify(session, null, 2), "utf8");
	sessions.set(id, session);
	return session;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 2_000_000) reject(new Error("Request body too large"));
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}
function sendJson(res: ServerResponse, value: unknown, status = 200): void { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); }
function sendFile(res: ServerResponse, path: string, type: string): void { res.writeHead(200, { "content-type": type }); res.end(readFileSync(path)); }

function feedbackText(session: ReviewSession, payload: FeedbackPayload): string {
	const annotations = (payload.annotations ?? []).filter((a) => (a.comment ?? "").trim() || (a.quote ?? "").trim());
	const lines = [`I reviewed the diff (${session.title}). Please address this feedback:`];
	annotations.forEach((a, i) => {
		const loc = a.scope === "file" ? `${a.file ?? "file"} entire file` : [a.file, a.side, a.start ? `lines ${a.start}${a.end && a.end !== a.start ? `-${a.end}` : ""}` : ""].filter(Boolean).join(" ");
		lines.push("", `${i + 1}. ${loc || "Diff selection"}`);
		if (a.quote?.trim()) lines.push("```diff", a.quote.trim(), "```");
		if (a.comment?.trim()) lines.push("Comment:", a.comment.trim());
	});
	const global = payload.globalComment?.trim();
	if (global) lines.push("", "Global feedback:", global);
	return lines.join("\n").trim();
}

function askText(session: ReviewSession, payload: AskPayload): string {
	const loc = payload.scope === "file" ? `${payload.file ?? "file"} entire file` : [payload.file, payload.side, payload.start ? `lines ${payload.start}${payload.end && payload.end !== payload.start ? `-${payload.end}` : ""}` : ""].filter(Boolean).join(" ");
	return [`Question about this diff selection (${session.title}):`, loc ? `\nLocation: ${loc}` : "", payload.quote?.trim() ? `\n\`\`\`diff\n${payload.quote.trim()}\n\`\`\`` : "", `\nQuestion:\n${(payload.question ?? "").trim()}`].join("\n").trim();
}

function startServer(pi: ExtensionAPI): Promise<number> {
	if (server && serverPort) return Promise.resolve(serverPort);
	const dist = join(__dirname, "dist");
	server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method === "GET" && url.pathname === "/api/review") {
				const id = url.searchParams.get("id") ?? "";
				const s = sessions.get(id);
				if (!s) return sendJson(res, { error: "Unknown review" }, 404);
				return sendJson(res, { ...s, patch: readFileSync(s.patchPath, "utf8") });
			}
			if (req.method === "POST" && url.pathname === "/api/feedback") {
				const payload = JSON.parse(await readBody(req)) as FeedbackPayload;
				const s = payload.id ? sessions.get(payload.id) : undefined;
				if (!s) return sendJson(res, { error: "Unknown review" }, 404);
				const msg = feedbackText(s, payload);
				if (msg) pi.sendUserMessage(msg);
				return sendJson(res, { ok: true });
			}
			if (req.method === "POST" && url.pathname === "/api/ask") {
				const payload = JSON.parse(await readBody(req)) as AskPayload;
				const s = payload.id ? sessions.get(payload.id) : undefined;
				if (!s) return sendJson(res, { error: "Unknown review" }, 404);
				pi.sendUserMessage(askText(s, payload));
				return sendJson(res, { ok: true, message: "Question sent to Pi. Check the terminal for the answer." });
			}
			if (req.method === "POST" && url.pathname === "/api/close") return sendJson(res, { ok: true });
			const file = url.pathname === "/" ? join(dist, "index.html") : join(dist, url.pathname);
			if (!file.startsWith(dist) || !existsSync(file)) return sendJson(res, { error: "Not found" }, 404);
			const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
			return sendFile(res, file, type);
		} catch (err) { return sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500); }
	});
	return new Promise((resolve) => server!.listen(0, "127.0.0.1", () => {
		const address = server!.address();
		const port = typeof address === "object" && address ? address.port : 0;
		serverPort = port; resolve(port);
	}));
}

function openBrowser(url: string): void {
	if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
	else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
	else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
async function openReview(pi: ExtensionAPI, ctx: ExtensionCommandContext, session: ReviewSession): Promise<void> {
	if (!existsSync(join(__dirname, "dist", "index.html"))) { ctx.ui.notify("review-lite UI is not built. Run npm install && npm run build in the extension folder.", "error"); return; }
	const port = await startServer(pi);
	openBrowser(`http://127.0.0.1:${port}/?id=${encodeURIComponent(session.id)}`);
	ctx.ui.notify(`Review opened: ${session.title}`, "info");
}

function parseLog(output: string): string[] { return output.split("\n").map((l) => l.trim()).filter(Boolean); }
async function chooseCommit(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const items = parseLog(runGit(ctx.cwd, ["log", "--oneline", "-n", "40"]));
	const selected = await ctx.ui.select("Choose commit to review", items);
	return selected?.split(/\s+/)[0];
}
function branchOptions(ctx: ExtensionCommandContext): string[] {
	const set = new Set<string>();
	function add(cmd: string[]) { try { for (const line of parseLog(runGit(ctx.cwd, cmd))) set.add(line.replace(/^refs\/remotes\//, "")); } catch {} }
	add(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
	add(["for-each-ref", "--format=%(refname:short)", "--sort=-committerdate", "refs/remotes", "refs/heads"]);
	return [...set].filter((b) => !b.endsWith("/HEAD")).slice(0, 80);
}
async function chooseBase(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const items = branchOptions(ctx);
	if (!items.length) { ctx.ui.notify("No branches found to use as base.", "warning"); return; }
	return await ctx.ui.select("Choose base branch for PR-style review", items);
}

export default function reviewLite(pi: ExtensionAPI): void {
	pi.registerCommand("review", { description: "Review staged + unstaged changes", handler: async (_args, ctx) => {
		try { const patch = runGit(ctx.cwd, ["diff", "HEAD", "--patch", "--find-renames", "--find-copies"]); if (!patch.trim()) return ctx.ui.notify("No changes against HEAD.", "info"); await openReview(pi, ctx, writeSession(ctx, { title: "Working tree vs HEAD", mode: "worktree", patch })); } catch (err) { ctx.ui.notify(err instanceof Error ? err.message : String(err), "error"); }
	}});
	pi.registerCommand("review-commit", { description: "Choose and review one commit", handler: async (_args, ctx) => {
		try { const commit = await chooseCommit(ctx); if (!commit) return; const patch = runGit(ctx.cwd, ["show", "--format=", "--patch", "--find-renames", "--find-copies", commit]); if (!patch.trim()) return ctx.ui.notify("Commit has no patch.", "info"); await openReview(pi, ctx, writeSession(ctx, { title: `Commit ${commit}`, mode: "commit", patch, commit })); } catch (err) { ctx.ui.notify(err instanceof Error ? err.message : String(err), "error"); }
	}});
	pi.registerCommand("review-base", { description: "Choose a base branch and review branch diff", handler: async (_args, ctx) => {
		try { const base = await chooseBase(ctx); if (!base) return; const patch = runGit(ctx.cwd, ["diff", `${base}...HEAD`, "--patch", "--find-renames", "--find-copies"]); if (!patch.trim()) return ctx.ui.notify(`No changes against ${base}.`, "info"); await openReview(pi, ctx, writeSession(ctx, { title: `HEAD vs ${base}`, mode: "base", patch, base })); } catch (err) { ctx.ui.notify(err instanceof Error ? err.message : String(err), "error"); }
	}});
}

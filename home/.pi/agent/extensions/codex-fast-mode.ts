import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

const CODEX_PROVIDER = "openai-codex"
const FAST_MODE_ORIGINATOR = "codex_cli_rs"

export default function codexFastMode(pi: ExtensionAPI): void {
  pi.on("before_provider_headers", (event, ctx) => {
    if (ctx.model?.provider !== CODEX_PROVIDER) return

    event.headers.originator = FAST_MODE_ORIGINATOR
    event.headers["x-codex-routing-hint"] = `model=${ctx.model.id};tier=priority`
  })

  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== CODEX_PROVIDER) return

    // SAFETY: openai-codex provider requests are JSON objects at this provider hook.
    const payload = event.payload as object
    return { ...payload, service_tier: "priority" }
  })
}

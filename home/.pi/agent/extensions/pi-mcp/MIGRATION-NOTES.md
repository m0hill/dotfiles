# MCP SDK v2 migration notes

Reviewed for the move from `@modelcontextprotocol/sdk` 1.x to the stable split v2 packages on 2026-07-28.

## Decisions

- Use `@modelcontextprotocol/client` and `@modelcontextprotocol/core` 2.0.0. The official migration guide identifies these as the v2 replacements for the monolithic v1 package and requires Node.js 20 or newer: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md>.
- Set `ClientOptions.versionNegotiation` to `{ mode: "auto" }`. The v2 protocol guide says this probes with `server/discover`, uses the modern era when available, and falls back to the unchanged 2025 `initialize` handshake for legacy servers: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md>.
- Keep the explicit `SSEClientTransport` fallback. Protocol-era negotiation does not replace transport fallback; the official client guide still recommends trying Streamable HTTP first and retrying SSE-only servers with a fresh client: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md>.
- Use `ClientOptions.listChanged` instead of directly registering the legacy tool-list notification. The v2 SDK maps this configuration to legacy unsolicited notifications and modern `subscriptions/listen`: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md#subscriptionslisten>.
- Preserve the callback query parameters through `finishAuth`, persist OAuth discovery state, and round-trip credential issuer stamps. These are the SDK migration guide's RFC 9207/RFC 8414 and SEP-2352 requirements: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md#authorization-server-mix-up-defense-rfc-9207--rfc-8414-33--action-required>.

## Relevant 2026-07-28 protocol changes

The current specification removes protocol sessions and initialization in the modern era, adds `server/discover`, replaces unsolicited change delivery with `subscriptions/listen`, introduces multi-round-trip `input_required` results, and moves protocol identity/capabilities into per-request metadata. The v2 client handles these wire differences behind the same client APIs. Source: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>.

Roots, sampling, logging, and HTTP+SSE are deprecated but remain available during the compatibility window. This client retains roots and elicitation handlers for legacy servers and for the SDK's modern multi-round-trip compatibility driver. Source: <https://modelcontextprotocol.io/specification/2026-07-28/changelog#deprecated>.

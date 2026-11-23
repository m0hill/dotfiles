import { accountRouter, defineApp, defineProvider, oauth2, toolAnnotations, withApprovals } from "apps";
import { mcpHealth, mcpRouter } from "apps/mcp";
import { always } from "apps/operations/approval";

// Superlogical's Rex Community MCP: Rex docs, changelog and archived Rex Beta
// Discord discussions. Sign-in is Discord OAuth (Rex Beta Discord members only);
// the server supports dynamic client registration, so no OAuth app is needed.
// Docs: https://www.superlogical.com/rex/docs/beta/community-mcp
const mcpUrl = "https://www.superlogical.com/rex/community-mcp";

const bearer = (account: { fields: { access_token: string } }) => ({
  Authorization: `Bearer ${account.fields.access_token}`,
});

const superlogical = defineProvider({
  name: "Superlogical",
  hosts: ["www.superlogical.com"],
  auth: { oauth: oauth2({ discover: mcpUrl }) },
  health: (check) => mcpHealth(check, { url: mcpUrl, headers: bearer(check.account) }),
});

export default defineApp(
  { user: { accounts: { superlogical: superlogical.many() } } },
  async ({ user, cache, signal }) => ({
    tools: await accountRouter(
      user?.accounts.superlogical ?? [],
      async (account) =>
        // Ask before any tool the server doesn't mark read-only.
        withApprovals(await mcpRouter({ url: mcpUrl, account, headers: bearer(account), cache, signal }), (tool) =>
          toolAnnotations(tool)?.readOnlyHint === true ? undefined : always(),
        ),
      { signal },
    ),
  }),
);

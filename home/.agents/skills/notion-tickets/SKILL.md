---
name: notion-tickets
description: Create tickets, tasks, and subtasks in Sind AI's Notion CTM Issues using the default template. Use when asked to file work in Notion or turn a discussion into a CTM ticket; clarify unanswered scope with grilling.
---

# Notion tickets

## Inspect and clarify

1. Discover Notion MCP tools with tool_search. For creation, search `+mcp__notion pages template_id parent data_source_id`.
2. Fetch CTM Issues database `37c3cbfd-60ac-8010-9dc0-e6d2c352332e`. Read its schema and current default template ID, then fetch that template. The live default is authoritative.
3. Use Notion search, scoped to its data source, for duplicates and related work. Fetch relevant hits; resolve likely duplicates before creating another ticket.
4. Reuse answers already in context. For unresolved outcome, scope, or acceptance criteria, load **grilling**, ask its frontier questions with recommendations, and wait for agreement. Look up facts yourself. Leave optional metadata unset unless supplied. If the user authorizes an incomplete backlog ticket, record open decisions in Notes rather than inventing answers.

## Create and fill

Read `notion://docs/enhanced-markdown-spec` through Notion fetch before writing content.

Call `notion_create_pages` using the fetched data source and default template. Verified payload:

```json
{
  "parent": {"data_source_id": "88c3cbfd-60ac-83be-bc30-078e2763cfd9"},
  "pages": [{
    "properties": {"Issue": "<agreed title>"},
    "template_id": "<current default template ID>"
  }],
  "allow_async": false
}
```

Omit `content` and icon/cover overrides so the actual template supplies blocks and defaults. Capture the page ID. If an async task is returned, wait for success; then fetch until template content appears, using bounded retries. A blank page is pending, not a reason to recreate it or reapply the template. After an ambiguous creation result, check for the existing ticket before retrying.

Fill placeholders on the **created page** with `notion_update_page`:

```json
{
  "page_id": "<created page ID>",
  "command": "update_content",
  "content_updates": [{
    "old_str": "## Summary\n<empty-block/>",
    "new_str": "## Summary\n<agreed summary>"
  }],
  "allow_async": false
}
```

Build unique exact matches from readback; combine disjoint edits in one call. Preserve the live headings/order (currently Summary, Requirements, Acceptance criteria, Notes). Use requirement bullets, unchecked acceptance criteria, and Notes for evidence, related tickets, and open decisions. Use native Notion mentions for internal references.

Set only agreed metadata with `update_properties`, following the fetched schema and tool formats. Resolve assignees through search with `query_type: "user"`. Preserve template defaults (currently Backlog); leave the generated issue ID to Notion.

## Verify

Fetch the finished ticket and check destination, title, template structure, content, and requested metadata. Return its link and issue number, plus any unresolved decisions or warnings.

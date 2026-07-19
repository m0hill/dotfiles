# Visual hierarchy

Visual hierarchy is the designed order in which people notice, group, and interpret interface content. It should express the product’s actual priorities and relationships, not merely make a screen look more decorative.

## Principles

- Rank content before styling it. Identify the user’s primary task or decision, critical status, supporting context, and metadata.
- Use a small, consistent set of meaningful levels. Add a level only when it represents a real difference in role.
- Combine cues: logical order, type size and weight, luminance contrast, spacing, alignment, enclosure, and purposeful imagery.
- Make emphasis relative and selective. If every title, price, badge, image, and button is loud, none is clearly primary.
- Put priority in the logical reading and task flow, not in a universally fixed corner.
- Keep visual and semantic hierarchy aligned. Formatting does not replace headings, lists, tables, labels, and programmatic relationships ([WCAG 1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)).
- Validate the result with realistic content and representative users; salience does not prove comprehension or task importance.

## Applying the guidance

### Build the information model first

1. State the page or component’s purpose in one sentence.
2. List what users must **know**, **decide**, and **do**.
3. Rank content by task relevance, consequence, urgency, and frequency.
4. Record relationships: title to item, label to value, origin to destination, status to object, and action to affected content.
5. Select a structure that represents those relationships before adding visual emphasis.

A useful working vocabulary is primary, secondary, and supporting content, but it is not a mandatory three-level formula. The same datum can change rank across contexts: delivery time may be supporting information while browsing and primary information after an order is late.

### Encode hierarchy with restrained cues

- **Order:** place essential information early in the meaningful sequence.
- **Typography:** use clearly distinguishable roles without using heading rank merely to obtain a visual size.
- **Spacing:** keep related content closer and separate groups with a larger, consistent interval.
- **Contrast and color:** reinforce emphasis while preserving readability and established semantic color roles.
- **Alignment:** use repeated anchors for comparable information and flow-relative start/end behavior for different writing directions.
- **Enclosure:** use containers or dividers only when they explain a real group or layer.
- **Imagery:** let an image dominate only when visual identification or evaluation is part of the task.

Critical distinctions should use more than one cue. Do not maximize every cue at once.

### Match presentation to the information task

- Use a **description list or labeled stack** for one object’s attributes.
- Use a **data table** when users compare the same attributes across rows or columns ([WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)).
- Use **cards** for discrete browseable objects whose content or actions differ.
- Use a **list** when sequence or rapid scanning matters more than enclosure.

Dense tables and expert tools are legitimate designs. Improve their titles, headers, grouping, alignment, and emphasis instead of reflexively converting them into spacious cards.

### Separate information and action hierarchy

A prominent fact is not necessarily interactive, and the strongest-looking action is not necessarily the safest default.

- Keep links and buttons recognizable as controls.
- Emphasize the likely next action only when its consequence is appropriate.
- Give destructive or irreversible actions explicit wording and confirmation proportional to risk.
- Keep action hierarchy consistent across comparable screens.

### Preserve hierarchy responsively

Keep information priority stable when geometry changes. Test narrow widths, zoom, larger text, localization, right-to-left content, missing images, and user-generated values. Avoid CSS reordering that makes visual order disagree with the meaningful DOM order, and do not hide essential content merely to preserve a clean composition ([WCAG 1.3.2](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html)).

## Accessibility

- Represent headings, groups, labels, lists, and tables programmatically.
- Do not rely on size, position, shape, or color alone to communicate relationships.
- Keep supporting text readable; “secondary” does not mean exempt from contrast requirements.
- Provide useful text alternatives for informative images and empty alternatives for decorative ones ([WAI Images Tutorial](https://www.w3.org/WAI/tutorials/images/)).
- Preserve meaningful sequence at zoom and during responsive reflow.
- Test the hierarchy with images unavailable, color reduced, and assistive technology navigating by headings or landmarks.

## Failure modes

- **Decoration defines priority:** the most colorful object wins even though it is not task-critical.
- **Everything is emphasized:** several elements compete at the same maximum level.
- **Position as a universal rule:** “top-right” or “above the fold” is applied regardless of writing direction, platform, or task.
- **Static text looks interactive:** link-like color or button-like enclosure creates a false signifier.
- **Images whenever possible:** irrelevant imagery adds noise, latency, or accessibility work without supporting a decision.
- **Cards as automatic improvement:** comparison becomes harder than in a table or aligned list.
- **Visual structure without semantics:** type size and whitespace imply headings or groups that markup does not expose.

## Checklist

- [ ] Is the page’s primary task or decision explicit?
- [ ] Are content levels based on user needs rather than decoration?
- [ ] Does each level use a restrained combination of cues?
- [ ] Can users distinguish information from controls?
- [ ] Is imagery purposeful and accessible?
- [ ] Does the chosen list, table, card, or labeled-stack structure match the comparison task?
- [ ] Are visual and semantic hierarchies aligned?
- [ ] Does the hierarchy survive zoom, reflow, localization, and missing media?
- [ ] Can users find the intended next action without being led?

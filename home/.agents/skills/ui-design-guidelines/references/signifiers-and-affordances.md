# Signifiers and affordances

## Principles

- An **affordance** is the action a person can perform in a particular environment. A **signifier** is a perceivable cue that helps them discover the action or understand state. Most outlines, labels, icons, cursors, highlights, and tooltips in screen interfaces are signifiers or learned conventions ([Don Norman](https://jnd.org/signifiers-not-affordances/)).
- Make important actions discoverable before interaction. Hover and trial-and-error may supplement a control but must not be the only way to find or understand it.
- Keep appearance, behavior, hit area, and programmatic semantics truthful. Anything that looks operable should respond over its apparent target; anything shown as selected, expanded, unavailable, or busy must actually have that state.
- Distinguish hover, keyboard focus, momentary press, persistent selection/current location, disabled/unavailable, loading, and success/error. A generic “active” highlight is not a sufficient state model.
- Use redundant cues for important meaning: text, shape, position, iconography, contrast, and programmatic state as appropriate. Color cannot be the only visible cue ([WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
- Pair visual grouping with structural grouping. A shared boundary or proximity can suggest a relationship, but headings, lists, fieldsets, regions, and component semantics must represent the same relationship ([WCAG 1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html)).

## Applying the guidance

### Make controls identifiable and predictable

- Prefer native elements and established platform patterns when they match the task.
- Use visible, task-oriented labels. Pair unfamiliar or consequential icons with text.
- Make the entire apparent control interactive; avoid a clickable card where only a small label responds.
- Use links for navigation and buttons for actions. Styling a link like a button does not change its behavior or semantics.
- Keep repeated functions and states visually consistent across comparable contexts.

### Define component states explicitly

Document only the states the component can actually enter:

- **Hover:** a pointer is over the target; supplemental and unavailable to many touch users.
- **Focus:** the current keyboard or assistive-technology target; it needs a persistent visible indicator.
- **Pressed:** transient acknowledgement during activation.
- **Selected/current:** a persistent choice or location, exposed through the applicable semantic state.
- **Unavailable:** the action cannot currently run.
- **Busy/result:** input was received and work is pending, complete, or failed.

Do not make hover look identical to current location, or press feedback look like completion of asynchronous work.

### Use unavailable states carefully

A gray appearance does not disable behavior or communicate why an action is unavailable. Before disabling a control, consider keeping it enabled and explaining unmet requirements on activation, validating inline, or progressively revealing it.

When disabling is the clearer choice:

- use native semantics where possible;
- prevent the operation in behavior, not only CSS;
- preserve a recognizable label and control shape;
- explain the reason and path to eligibility when it is not obvious;
- do not put the only explanation in a tooltip attached to an unfocusable disabled control.

### Treat tooltips as supplemental

Use tooltips for brief, nonessential clarification. Required instructions, errors, and recovery actions should remain visible. Hover/focus content must be dismissible, hoverable, and persistent where [WCAG 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) applies. An icon-only control still needs a programmatic name; a tooltip does not provide that contract by itself.

## Accessibility

- Expose each control’s accessible name, role, state, and value; prefer native HTML before adding ARIA ([WCAG 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)).
- Preserve equivalent operation for keyboard, touch, pointer, voice, switch-like input, magnification, and screen readers.
- Provide visible keyboard focus and keep focused controls from being obscured.
- Ensure component boundaries, state indicators, and meaningful icons remain perceivable, including in forced-colors modes.
- Validate conventions with representative users when the iconography, gesture, state, or domain is unfamiliar.

## Failure modes

- **False signifier:** something looks clickable but has no action, or only part of its apparent target responds.
- **Hidden action:** a draggable, expandable, or interactive element has no visible cue or accessible alternative.
- **Gray means disabled:** styling suggests unavailability but behavior and semantics disagree.
- **Hover-only discovery:** touch and keyboard users cannot discover the control or explanation.
- **Ambiguous highlight:** hover, focus, selection, and current location share one treatment.
- **Instructions as a patch:** explanatory copy compensates for a control whose label or form predicts the wrong outcome.
- **Visual-only grouping:** enclosure implies a relationship that the document or accessibility tree does not contain.

## Checklist

- [ ] Can users identify the important actions before interacting?
- [ ] Does each control’s appearance predict its actual result?
- [ ] Do apparent and actual hit areas agree?
- [ ] Are navigation and commands represented with the correct semantics?
- [ ] Are hover, focus, press, selection/current, unavailable, and busy states distinct where applicable?
- [ ] Are important meanings reinforced without relying on color or motion alone?
- [ ] Are unavailable actions truthful and explained when necessary?
- [ ] Is tooltip content supplemental and available from keyboard focus?
- [ ] Does visual grouping match semantic structure?
- [ ] Has the interface been tested without a fine pointer and with assistive technology?

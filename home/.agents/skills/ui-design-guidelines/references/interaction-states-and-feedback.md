# Interaction states and feedback

Feedback should tell users whether input was received, what is happening, what changed, and what they can do next. Design a state model from actual behavior instead of producing a fixed list of visual mockups.

## Principles

- Make feedback proportional to consequence. An immediate visible change may be enough for a local action; asynchronous or consequential work needs pending, success, failure, and recovery states.
- Inventory applicable input, semantic, availability, process, and data states. States can overlap: an invalid field can also be focused.
- Do not prescribe a universal four-state button minimum. Hover is pointer-dependent, unavailable and loading states are conditional, and visible keyboard focus is essential.
- Separate transient activation from persistent selection, checked, expanded, or toggle state.
- Acknowledge latency honestly, prevent conflicting duplicate work, and resolve every pending state.
- Make errors specific, associate them with their source, preserve user input, and provide recovery.
- Expose the same state visually and programmatically; custom styling does not replace semantics or announcements.

## Applying the guidance

### Build the state inventory

Use these families as prompts, not mandatory rows for every component:

| Family | Examples | Key question |
| --- | --- | --- |
| Resting | empty, populated, default | Is the component understandable before interaction? |
| Input | hover, focus, pressed, drag | Can each supported modality perceive where interaction is directed? |
| Persistent value | selected, checked, toggled, expanded, current | Does the state persist and match programmatic value? |
| Availability | enabled, read-only, unavailable | Can users understand what is possible and why? |
| Validation | valid, invalid, warning | Is the condition explained and actionable? |
| Process | idle, queued, busy, partial, success, failure, cancelled | Is request, progress, and outcome clear? |
| Data | empty, loading, stale, offline, no results | Is absence distinguished from failure and pending work? |

Define valid combinations and precedence. A hover fill must not erase focus; an unavailable treatment must not hide a selected value users still need to understand.

### Match feedback to the lifecycle

1. **Acknowledge activation:** use native press/highlight behavior or an equivalent immediate cue.
2. **Show pending work when perceptible:** place status at the control or affected region and label the operation.
3. **Use honest progress:** determinate only when progress is trustworthy; otherwise use an explicit indeterminate busy state.
4. **Manage interaction while busy:** prevent duplicate destructive or financial actions while leaving unrelated work usable.
5. **Resolve pending state:** transition to success, empty, cancelled, offline, or failure; never spin forever.
6. **Preserve continuity:** retain input, selection, focus, and scroll unless completion logically changes context.

Do not show a spinner without saying what is happening. Offer cancellation for long or costly work when technically and conceptually safe.

### Design controls by semantics

- Keep focus, transient activation, and persistent selection distinct.
- Treat hover as enhancement, never as required discovery.
- Use unavailable controls deliberately. If users need to know why an action cannot run, provide persistent explanatory text or another focusable route.
- During busy work, retain or update the action label—for example, “Saving…”—rather than replacing all meaning with an indicator.
- Prevent only conflicting actions; avoid freezing an entire screen for a local update.

### Validate and support recovery

- Provide persistent labels and necessary instructions before errors occur.
- Validate when users can act on the result; avoid declaring ordinary partially typed input invalid on every keystroke.
- Identify the field and problem in text, preserve its value, and state how to fix it when known.
- Associate inline help and errors programmatically.
- Distinguish meanings: an **error** blocks completion, a **warning** communicates a credible consequence the user may accept, and **information** provides context.
- Use color and icons as reinforcement, not as the only explanation.

For long forms, consider an error summary linked to affected fields while keeping inline messages at each source.

### Choose the feedback surface

- **Changed content/control:** preferred when the new state is already obvious.
- **Inline status:** appropriate for local loading, validation, and results.
- **Toast or nonmodal notification:** useful for brief outcomes whose source may be off-screen; do not stack routine confirmations.
- **Persistent banner:** for information users must revisit or act on.
- **Dialog:** only when work must stop for an urgent decision or consequential acknowledgement.

Keep important errors and recovery actions available. Do not move focus for routine updates; move it only when a new context requires it, such as entering a modal or reaching a form error summary.

### Use motion, sound, and haptics as channels

Animation may communicate continuity, causality, or progress, but the final state must remain understandable without it. Sound and haptics may reinforce important events where platform conventions support them; they must not be the sole carrier of meaning. Avoid feedback on every pointer movement, keystroke, or scroll tick.

## Accessibility

- Provide a visible focus indicator that remains while the component is focused ([WCAG 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)).
- Expose applicable name, role, selected/checked/expanded/pressed state, availability, invalidity, and busy status; prefer native elements.
- Announce important waiting, progress, result, and error messages that do not receive focus ([WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).
- Use polite status announcements for routine updates and assertive alerts only for urgent, time-sensitive conditions.
- Pair color with text, shape, icon, or another visible cue.
- Honor reduced-motion preferences and avoid unnecessary celebration or rapidly changing labels.
- Test pointer, keyboard, touch, screen readers, speech, zoom/reflow, forced colors, and localization.

## Failure modes

- **Four states as a standard:** focus is omitted while irrelevant disabled/loading states are drawn.
- **Press means success:** asynchronous work appears complete before the result exists.
- **Spinner forever:** pending work has no timeout, failure, cancellation, or recovery.
- **Fake progress:** invented percentages or time estimates mislead users.
- **Error by red border:** the condition and correction are not stated.
- **Warning means optional issue:** urgency is based on color rather than consequence.
- **Toast for everything:** routine updates create noise and disappear before action.
- **Live region overload:** every minor change interrupts assistive-technology users.
- **Whole-page blocking:** unrelated work becomes unavailable during a local request.
- **State collisions:** hover, focus, selected, invalid, and unavailable styles overwrite one another.

## Checklist

- [ ] Are applicable states derived from behavior rather than a template?
- [ ] Are focus, press, selection, availability, and busy state distinct?
- [ ] Does every asynchronous path resolve to a truthful outcome?
- [ ] Are duplicate or conflicting actions prevented without blocking unrelated work?
- [ ] Are progress and time estimates honest?
- [ ] Do errors preserve input, identify the source, and provide recovery?
- [ ] Is the feedback surface proportional to importance and persistence?
- [ ] Are visual state and programmatic state synchronized?
- [ ] Are status announcements useful without becoming noisy?
- [ ] Does the experience work without color, hover, sound, or motion?

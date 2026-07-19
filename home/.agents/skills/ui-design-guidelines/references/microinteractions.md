# Microinteractions

A microinteraction is a small, bounded interaction around one task or state change. It is not a synonym for animation. Model its trigger, rules, feedback, and behavior over repetition.

## Principles

- Define states and transitions before drawing motion.
- Distinguish input acknowledgement, pending work, and truthful outcome feedback.
- Prefer the smallest feedback that makes the result clear: changed state, text, count, status, sound, haptic, or motion.
- Treat animation as optional. It may explain continuity or attract attention, but it must not certify success or carry essential meaning alone.
- Keep routine feedback close to the initiating control, timely, concise, and proportional to consequence.
- Design failure, cancellation, retry, repeated activation, concurrency, offline behavior, and delayed responses—not only the happy path.
- Judge the interaction by comprehension, error prevention/recovery, confidence, and efficiency rather than visual delight.

## Applying the guidance

### Write the state model

For a copy action, for example:

`idle → acknowledged → copying → copied | failed → idle/retry`

Specify:

1. **Trigger:** pointer, touch, keyboard, shortcut, voice, system event, or threshold.
2. **Rules:** prerequisites, permissions, validation, concurrency, and cancellation.
3. **Feedback:** what each input and system state communicates visually and programmatically.
4. **Loops and modes:** repeated activation, timeout, retry, undo, accumulation, and changed behavior on later use.

This exposes missing paths that a polished success animation can hide.

### Layer feedback by what it proves

- **Discoverability/focus:** the action is available and the control receiving input is identifiable.
- **Acknowledgement:** press, ripple, haptic, or immediate state change shows that activation registered.
- **Pending/progress:** work continues after acknowledgement.
- **Outcome:** explicit state says what succeeded or failed.
- **Persistence/recovery:** consequential results remain visible or have undo, retry, history, or another durable route.

Do not claim success on click when completion depends on permission, a promise, network response, server commit, or background job.

### Select a proportional presentation

- Use control-level or inline state for routine local outcomes.
- Use a nonmodal status when the source may no longer be visible.
- Keep important errors or recovery actions persistent.
- Interrupt with a dialog only when a decision or risk requires the user to stop.
- Preserve focus and task context for ordinary updates.

Write specific messages: “Email address copied” communicates more than “Done.” On failure, say what did not happen and offer a next step. Localize copy and test expansion.

### Use motion to explain

Motion can show causality, direction, continuity, and spatial relationships.

- Keep source and destination visually connected when orientation benefits.
- Avoid moving surrounding layout solely to reveal feedback; reserve space or overlay appropriately.
- Use restrained motion for frequent, high-throughput actions.
- Preserve the state and message under reduced motion, replacing spatial transitions with an instant or subtle non-spatial change.
- Ensure interrupted animations, route changes, and unmounted components cannot leave state half-applied.
- Do not adopt a universal duration; distance, frequency, content, device, and preference all matter.

### Design repetition and concurrency

Microinteractions often fail on the second activation:

- define whether repetition is idempotent, toggles, restarts, queues, or is ignored;
- prevent duplicate submissions without making the interface appear frozen;
- associate completion with the correct initiating item when operations overlap;
- replace or update existing status instead of stacking duplicates;
- prevent stale success feedback from overwriting a later failure;
- provide a persistent route when transient feedback contains an action.

### Coordinate channels

Visual, auditory, and haptic feedback can reinforce one another but must respect platform and user settings. Avoid sound or vibration for routine high-frequency events, and never make either the only signal for success, warning, or failure.

## Accessibility

- Keep controls keyboard operable with visible focus and correct programmatic state.
- Announce meaningful status changes without moving focus unnecessarily ([WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).
- Respect `prefers-reduced-motion` and preserve meaning when movement is removed ([Media Queries](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion)).
- Avoid large, nonessential interaction-triggered movement and flashing.
- Keep transient text available long enough to perceive; persistent actions should not disappear on a timer.
- Do not rely on motion, sound, haptics, iconography, or color alone.
- Test touch, pointer, keyboard, screen reader, speech input, repeated activation, latency, and localization.

## Failure modes

- **Animation equals microinteraction:** decoration is added without a useful state model.
- **Click feedback equals success:** input acknowledgement appears to confirm an operation that may fail.
- **Happy path only:** rejection, offline behavior, retry, and cancellation are absent.
- **Motion as evidence:** users cannot understand the outcome with reduced motion.
- **Delight tax:** frequent flourish slows expert work and becomes distracting.
- **Layout-shifting status:** nearby content moves when a message appears.
- **Duplicate feedback:** rapid actions queue overlapping visual and spoken notifications.
- **Stale completion:** an older asynchronous result overwrites newer state.
- **Transient recovery:** undo or retry disappears before users can act.

## Checklist

- [ ] Are trigger, rules, states, feedback, and repetition documented?
- [ ] Are acknowledgement, pending work, and outcome distinct?
- [ ] Can the operation fail, cancel, retry, or run concurrently?
- [ ] Is the feedback truthful and proportional?
- [ ] Does the interaction remain understandable without animation?
- [ ] Does reduced motion preserve state and messaging?
- [ ] Are repeated activations deterministic and deduplicated?
- [ ] Can stale asynchronous results corrupt current state?
- [ ] Are status changes exposed programmatically without stealing focus?
- [ ] Has the interaction been tested under latency and interruption?

# Design research and inspiration

Research reduces uncertainty about people, problems, constraints, and outcomes. Inspiration broadens possible solutions. A gallery of shipped interfaces can support precedent research, but screenshots are not evidence that a pattern works for the current users.

## Principles

- Start with the decision, user, task, and context—not a visual treatment.
- Match the source to the question: direct user evidence for needs and behavior; standards for requirements; maintained design systems for reusable patterns; live products for comparative evidence; galleries for visual exploration.
- Treat every precedent as a hypothesis, not an answer.
- Compare multiple examples and counterexamples before extracting a principle.
- Inspect behavior and the complete flow, not only polished screenshots.
- Separate observations, interpretations, assumptions, and evidence.
- Prototype and test adopted patterns in the actual context. A prominent company shipping something does not prove usability, accessibility, or transferability.

## Applying the guidance

### Frame the research

Write a short brief before browsing:

- **Decision:** what choice will this evidence inform?
- **People and task:** who is trying to accomplish what?
- **Context:** environment, platform, frequency, expertise, language, connectivity, and risk.
- **Constraints:** accessibility, policy, privacy, security, technology, content, and operations.
- **Unknowns:** what assumptions could change the decision?
- **Success evidence:** observable task outcomes and guardrails, not “looks modern.”

Begin with existing research, support contacts, analytics, field observations, and subject-matter knowledge. Identify gaps rather than repeating work.

### Use an evidence ladder

Use the strongest applicable evidence:

1. **Direct evidence:** observation, interviews, usability evaluation, support cases, behavioral and operational data.
2. **Requirements:** accessibility standards, policy, security/privacy constraints, and official platform guidance.
3. **Maintained solutions:** the product’s own design system, then relevant official systems with documented boundaries.
4. **Comparative evidence:** current live products solving the same or analogous task.
5. **Inspiration:** galleries, portfolios, awards, mood boards, and trend collections.

Lower levels are not useless; they answer different questions. A mood board can guide art direction but cannot validate checkout usability. Analytics may show where behavior happens but not why.

### Build a comparative set

Include direct competitors, analogous services, standard patterns, and failures. For each example record:

- source, product/version, platform, and capture date;
- intended audience and task hypothesis;
- surrounding journey and entry/exit points;
- observed behavior and supported states;
- apparent strengths, accessibility/trust risks, and unknowns;
- constraints that may prevent transfer.

Frequency demonstrates prevalence, not effectiveness. Avoid collecting only attractive examples that confirm the first idea.

### Inspect the live implementation

Review:

- happy path plus empty, loading, validation, error, offline, cancellation, and recovery states;
- responsiveness, zoom/reflow, text expansion, localization, and missing content;
- pointer, touch, keyboard, and assistive-technology behavior;
- names, roles, states, focus order, announcements, targets, contrast, and motion preferences;
- trust implications such as consent, defaults, fees, data use, irreversible actions, and cancellation;
- technical and operational dependencies.

A live product remains one observation. It may be personalized, experimental, stale, or designed under constraints unlike yours.

### Synthesize without copying

Organize findings by user problem or task step, not by brand. For each pattern state:

- what was directly observed;
- the interpretation and supporting evidence;
- where it may or may not transfer;
- accessibility, trust, and failure risks;
- the hypothesis that still needs testing.

Extract the principle instead of tracing pixels. Generate materially different responses to the evidence, prototype the smallest useful versions, and test them with representative users.

### Turn evidence into a decision

Evaluate candidates against explicit criteria: user outcome, accessibility, clarity, trust, consistency, content fit, technical feasibility, operational cost, and measurable risk. Record why a pattern was chosen and what evidence would trigger reconsideration.

## Accessibility

- Include disabled participants and relevant assistive technologies in research plans.
- Do not infer accessibility from a screenshot, a famous brand, or a design-system component name.
- Evaluate keyboard operation, semantics, focus, contrast, motion, zoom, reflow, language, and cognitive demands in context.
- Provide accessible research materials and participation methods.
- Avoid excluding users through inaccessible recruitment, scheduling, prototypes, consent materials, or remote tools.
- Protect participant privacy and collect only data necessary for the decision.

## Failure modes

- **Inspiration presented as research:** attractive examples substitute for evidence about user needs.
- **Prestige as proof:** a well-known team’s design is assumed effective or transferable.
- **Screenshot-only analysis:** states, semantics, latency, recovery, and accessibility are invisible.
- **Design fixation:** the first precedent narrows the solution space before the problem is understood.
- **Popularity equals quality:** repeated patterns are copied without evidence of outcomes.
- **One design system as universal:** local conventions are detached from their platform and audience.
- **Research theater:** many artifacts are produced without changing a decision.
- **Testing only the happy path:** failure and recovery remain unexamined.

## Checklist

- [ ] Is the decision and research question explicit?
- [ ] Are users, tasks, context, risks, and constraints documented?
- [ ] Does each source match the claim it is being used to support?
- [ ] Does the sample include alternatives and counterexamples?
- [ ] Were complete flows and non-happy states inspected?
- [ ] Are observations separated from interpretations and assumptions?
- [ ] Were accessibility and trust risks evaluated?
- [ ] Was more than one solution generated?
- [ ] Will representative users test the adopted pattern?
- [ ] Is the final decision traceable to evidence?

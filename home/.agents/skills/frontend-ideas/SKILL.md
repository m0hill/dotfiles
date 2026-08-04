---
name: frontend-ideas
description: Generate genuinely non-generic frontend directions by pitting adversarial Herdr peers against each other. For greenfield or "just make it cool / something not-usual" briefs where the user can't specify the target.
disable-model-invocation: true
---

# Frontend Ideas

Use when the goal is a **distinctive** frontend and the user cannot name the destination — "make it cool", "something not-usual", greenfield with no reference. A single context converges to the mean; this skill manufactures the variation the model won't produce on its own, then makes the user the filter.

Novelty here = **you supply randomness → peers supply the connections → the user supplies recognition.** The model is great at bridging a random anchor to the problem; it is bad at *choosing* to leave the mean. So force the leaving.

## 1. Frame + seed

Restate the brief in one line (page kind, audience, the effect it should create). Do not stop for clarification — make explicit assumptions.

Then generate **randomness the model didn't choose**: pick 3–4 arbitrary anchors from unrelated domains — an object, an era, a profession, a material (e.g. *coral, 1970s cassette decks, air-traffic control, brutalist parking garages*). These are seeds to walk *from*, not answers. Complete when each direction has a distinct anchor.

## 2. Decide: peers or solo

Adversarial peers earn their token cost only when hunting *genuine* novelty on a real design. For a quick pass, or if `HERDR_ENV` is unset, skip to **Solo fallback** at the bottom.

If using peers, read `herdr-agent-threads` for the `threadctl` interface and confirm agent/model/thinking with the user before starting any peer.

## 3. Assign incompatible mandates (the whole trick)

The lever is **mandated incompatibility**, not the number of peers. Same-prior peers told to "debate" perform fake conflict and converge to the average with extra steps. Prevent that:

- Give each peer **one incommensurable value, not an opinion** — "optimize *only* for density"; "*only* for calm"; "*only* for surprise". Values that cannot all be satisfied at once.
- Give each peer **a different seed** from step 1, so collisions have somewhere new to go.
- **Forbid convergence.** Hard rule in every task: no conceding, no middle ground, no "we could combine" until told. Premature synthesis kills the novelty.
- Each peer produces a concrete direction: one-sentence thesis, a real expression (layout/type/color/motion, actual HTML if useful), and how it defies the generic default.

Start 3 peers this way (see `herdr-agent-threads`). Let them exchange 2–3 rounds under the no-convergence rule.

## 4. Synthesize with a separate judge

The debaters are too committed to resolve their own fight. Start **one more, non-participating peer** (or do this in your own context) whose only prompt is: *read the transcript; name the position that would make this whole argument obsolete.* The emergent **third position** — not the average, a reframe neither peer held — is the payload. Also have it flag which directions are genuinely unusual vs. merely weird.

Complete when you have 3–5 distinct directions plus at least one reframe.

## 5. Present for recognition, not approval

The user doesn't know the target; they recognize it on sight. Show the directions compactly — thesis + what makes each not-generic + the reframe — and ask which one gives them *the feeling*. Offer to build the winner or to re-diverge "less like all of these" using the shown set as the new mean to escape.

Close any peers (`threadctl close`).

## Solo fallback (no peers)

Run steps 1, 3, 4 in your own context: adopt each incompatible mandate in turn, write its direction, refuse to converge, then switch to a cold critic voice for the synthesis. Weaker than real peers (shared priors), but far better than one unseeded ask. Follow `diverge` for structure.

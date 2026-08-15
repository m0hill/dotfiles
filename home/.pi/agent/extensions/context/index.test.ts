import assert from "node:assert/strict"
import test from "node:test"
import { buildContextBreakdown } from "./index.ts"

test("classifies provider-reported reasoning without leaving it as overhead", () => {
  const breakdown = buildContextBreakdown({
    systemPrompt: "",
    contextFiles: [],
    skills: [],
    tools: [],
    messages: [
      {
        role: "assistant",
        tokens: 100,
        estimatedThinkingTokens: 10,
        reportedReasoningTokens: 40,
      },
    ],
    reportedTokens: 130,
  })

  assert.deepEqual(breakdown.categories, [
    { id: "assistant", label: "Assistant", tokens: 90 },
    { id: "reasoning", label: "Reasoning", tokens: 40 },
  ])
})

test("caps reasoning attribution at the provider total when other estimates run high", () => {
  const breakdown = buildContextBreakdown({
    systemPrompt: "x".repeat(26_936),
    contextFiles: [],
    skills: [],
    tools: [],
    messages: [
      { role: "user", tokens: 481 },
      {
        role: "assistant",
        tokens: 1_111,
        estimatedThinkingTokens: 87,
        reportedReasoningTokens: 681,
      },
      { role: "toolResult", tokens: 2_762 },
    ],
    reportedTokens: 11_652,
  })

  assert.equal(breakdown.categories.find((category) => category.id === "reasoning")?.tokens, 651)
  assert.equal(
    breakdown.categories.some((category) => category.id === "overhead"),
    false
  )
  assert.equal(breakdown.estimatedTokens, 11_652)
})

test("estimates visible thinking when the provider does not report a reasoning breakdown", () => {
  const breakdown = buildContextBreakdown({
    systemPrompt: "",
    contextFiles: [],
    skills: [],
    tools: [],
    messages: [
      {
        role: "assistant",
        tokens: 100,
        estimatedThinkingTokens: 10,
      },
    ],
    reportedTokens: 100,
  })

  assert.deepEqual(breakdown.categories, [
    { id: "assistant", label: "Assistant", tokens: 90 },
    { id: "reasoning", label: "Reasoning", tokens: 10 },
  ])
})

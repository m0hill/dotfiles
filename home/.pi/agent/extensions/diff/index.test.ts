import assert from "node:assert/strict"
import test from "node:test"
import { parsePatchFiles } from "@pierre/diffs"
import {
  joinPatchDocuments,
  validatePatchLine,
  validateSnapshotAgainstPatch,
} from "./index.ts"

test("validates a full snapshot when the serialized patch trims its final context newline", () => {
  const patch = [
    "diff --git a/example.ts b/example.ts",
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1,3 +1,3 @@",
    " first",
    "-old",
    "+new",
    " final",
  ].join("\n")
  const file = parsePatchFiles(patch, "test", false).flatMap((item) => item.files)[0]

  assert.ok(file)
  assert.equal(validateSnapshotAgainstPatch(file, "first\nold\nfinal\n", "first\nnew\nfinal\n"), undefined)
})

test("preserves a valid trailing newline when composing worktree patches", () => {
  assert.equal(joinPatchDocuments("first patch\n", "second patch"), "first patch\nsecond patch\n")
})

test("still rejects different source lines", () => {
  assert.equal(
    validatePatchLine("const enabled = true\n", "const enabled = false\n", "line"),
    "line does not match the saved patch"
  )
})

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const THREAD_SKILL_PATH = join(homedir(), ".agents", "skills", "herdr-agent-threads", "SKILL.md")

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Load instructions for using Herdr threads as subagents. Call when delegation or subagents are needed.",
    parameters: Type.Object({}),
    async execute() {
      const skill = await readFile(THREAD_SKILL_PATH, "utf8")
      return {
        content: [{ type: "text", text: skill }],
        details: { skillPath: THREAD_SKILL_PATH },
      }
    },
  })
}

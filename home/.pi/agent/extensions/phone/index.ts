import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createJiti } from "jiti"

const loadTsx = createJiti(import.meta.url, {
  moduleCache: false,
  jsx: {
    runtime: "automatic",
    importSource: "datastar-kit",
    throwIfNamespace: false,
  },
})

/** Loads the TSX phone extension with Datastar's automatic JSX runtime. */
export default async function phone(pi: ExtensionAPI): Promise<void> {
  const extension = await loadTsx.import<typeof import("./extension.tsx")>("./extension.tsx")
  await extension.default(pi)
}

import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const rootDir = fileURLToPath(new URL(".", import.meta.url))
const extension = process.env.PI_EXTENSION!
const extensionRoot = resolve(rootDir, "agent/extensions", extension)

export default defineConfig({
  root: extensionRoot,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})

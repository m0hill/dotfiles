import { stripVTControlCharacters } from "node:util"
import { StringDecoder } from "node:string_decoder"
import { truncateTail } from "@earendil-works/pi-coding-agent"

const RETAINED_BYTES = 200 * 1024
const RETAINED_LINES = 2_000

/** A bounded, terminal-safe tail of combined process output. */
export class OutputTail {
  readonly #decoder = new StringDecoder("utf8")
  #content = ""
  #finished = false
  #observedBytes = 0
  #truncated = false

  /** Append one raw stdout/stderr chunk. */
  append(data: Buffer): void {
    if (this.#finished) return
    this.#observedBytes += data.byteLength
    this.#appendDecoded(this.#decoder.write(data))
  }

  /** Flush an incomplete UTF-8 sequence after process settlement. */
  finish(): void {
    if (this.#finished) return
    this.#finished = true
    this.#appendDecoded(this.#decoder.end())
  }

  /** Return the retained plain-text output. */
  content(): string {
    return this.#content
  }

  /** Return whether older output was discarded. */
  wasTruncated(): boolean {
    return this.#truncated
  }

  /** Return the number of raw bytes observed before sanitization. */
  observedBytes(): number {
    return this.#observedBytes
  }

  #appendDecoded(decoded: string): void {
    if (!decoded) return

    const safe = sanitizeTerminalText(decoded)
    const next = truncateTail(this.#content + safe, {
      maxBytes: RETAINED_BYTES,
      maxLines: RETAINED_LINES,
    })
    this.#content = next.content
    this.#truncated ||= next.truncated
  }
}

/** Remove ANSI escapes and unsafe control characters while preserving ordinary log layout. */
export function sanitizeTerminalText(input: string): string {
  return stripVTControlCharacters(input).replace(
    // Preserve tab, line feed, and carriage return; the remaining C0/C1 controls are intentionally matched.
    // oxlint-disable-next-line no-control-regex -- Terminal output is untrusted and must not inject control characters into Pi's UI.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu,
    ""
  )
}

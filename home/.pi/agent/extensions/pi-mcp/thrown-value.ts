import { z } from "zod"

const ErrorSchema = z.instanceof(Error)
const ThrownValueSchema = z.unknown().transform((value) => {
  const error = ErrorSchema.safeParse(value)
  if (error.success) {
    return {
      kind: "error" as const,
      name: error.data.name,
      message: error.data.message,
    }
  }
  return { kind: "non-error" as const }
})

type ThrownValue = z.output<typeof ThrownValueSchema>

/** Parses an arbitrary thrown JavaScript value into a safe diagnostic representation. */
export function parseThrownValue(value: z.input<typeof ThrownValueSchema>): ThrownValue {
  return ThrownValueSchema.parse(value)
}

/** Formats a parsed thrown value without exposing its original object or secrets. */
export function formatThrownValue(value: ThrownValue): string {
  return value.kind === "error" ? `${value.name}: ${value.message}` : "non-Error value"
}

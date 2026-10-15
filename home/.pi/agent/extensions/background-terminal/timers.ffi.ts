/** Read the real wall clock in milliseconds. */
export function now(): number {
  return Date.now()
}

/** Resolve with the promise's value, or `undefined` if it has not settled within `timeoutMs`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

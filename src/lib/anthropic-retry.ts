const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1000, 2000]
const RETRYABLE = new Set([500, 503, 529])

function isRetryable(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    RETRYABLE.has((err as { status: number }).status)
  )
}

export async function withAnthropicRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await operation()
    } catch (err) {
      if (!isRetryable(err)) throw err
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1]
        console.log(
          `[anthropic] overloaded, retry ${attempt + 1}/${MAX_ATTEMPTS} in ${delay / 1000}s...`,
        )
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

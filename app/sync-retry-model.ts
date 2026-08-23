export type RetryResponse = { status: number };

export type RetryOptions = {
  maxAttempts?: number;
  delay?: (attempt: number) => Promise<void>;
};

/**
 * Retries only transient transport/server failures. A 4xx response is a
 * durable validation or authorization result and must be returned immediately
 * so sync callers do not duplicate an unsafe request.
 */
export async function retryTransient<T extends RetryResponse>(operation: () => Promise<T>, options: RetryOptions = {}) {
  const requestedAttempts = options.maxAttempts ?? 3;
  const maxAttempts = Number.isSafeInteger(requestedAttempts) && requestedAttempts > 0 ? requestedAttempts : 1;
  let lastError: unknown;
  let lastResponse: T | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await operation();
      if (response.status < 500 || attempt === maxAttempts - 1) return response;
      lastResponse = response;
    } catch (cause) {
      lastError = cause;
      if (attempt === maxAttempts - 1) throw cause;
    }
    if (options.delay) await options.delay(attempt);
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("一時的な通信障害から復旧できませんでした。");
}

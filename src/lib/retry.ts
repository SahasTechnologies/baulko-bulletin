/**
 * Bounded retries for the calls that leave this process.
 *
 * Three things here are worth being explicit about, because a retry loop is
 * easy to write in a way that makes an outage worse.
 *
 * It is bounded twice over. There is a maximum number of attempts *and* a
 * deadline, and the deadline is checked against the clock rather than assumed
 * from the delay arithmetic. A caller inside a serverless function has a few
 * seconds before the platform kills it, and a retry that outlives the response
 * is not a retry — it is a second request nobody is waiting for.
 *
 * It only retries what can change. `shouldRetry` is the caller's judgement:
 * a 500 from Resend or a dropped connection may well succeed on the next try,
 * while a 422 or a 401 will fail identically forever, and retrying those just
 * burns the caller's budget and buries the real error.
 *
 * It never decides what "failed" means. The wrapped operation returns its own
 * result type — a sentinel, a status object, whatever it already had — and this
 * only decides whether to try again. Callers keep their existing error
 * reporting, which is why adding retries did not change any of their callers.
 */

/**
 * What one try is told about the loop it is inside. The budget is the point of
 * it: an operation that can wait (a fetch with a timeout) sizes its own timeout
 * to what is left, so the loop's total is the deadline and not "the deadline,
 * plus whichever attempt was already in flight when it ran out".
 */
export interface AttemptBudget {
  /** 1 for the first try. */
  tryNumber: number;
  /** Milliseconds left before the deadline, from the caller's own clock. */
  remainingMs: number;
}

export interface RetryOptions<T> {
  /** Total tries, including the first. */
  attempts?: number;
  /** First delay; each one after it is multiplied by `factor`. */
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  /** Give up once the delay would land past this many milliseconds from the start. */
  deadlineMs?: number;
  /** Whether the outcome of one try is worth another. */
  shouldRetry: (result: T | undefined, error: unknown) => boolean;
  /** Called before each wait, for the log line that explains the delay. */
  onRetry?: (info: { attempt: number; delayMs: number; error?: unknown }) => void;
  /** Injected by the tests, and by nothing else. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt` until it stops reporting something worth retrying.
 *
 * Returns the last result whatever happens: an exhausted loop hands back the
 * final failure exactly as one try would have, so a caller that already handles
 * "the send failed" needs no new branch. A thrown error is re-thrown only when
 * `shouldRetry` says the throw was final, or when the attempts run out — the
 * difference between "this is broken" and "this did not work yet".
 */
export async function retryWithBackoff<T>(
  attempt: (budget: AttemptBudget) => Promise<T>,
  options: RetryOptions<T>
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 300;
  const factor = options.factor ?? 3;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const deadlineMs = options.deadlineMs ?? 10_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const startedAt = now();
  let lastResult: T | undefined;
  let lastError: unknown;
  let threw = false;

  for (let tryNumber = 1; tryNumber <= attempts; tryNumber++) {
    const remainingMs = deadlineMs - (now() - startedAt);
    // Out of time before the attempt even starts: handing back the last failure
    // is the same answer the caller would get from an exhausted loop.
    if (tryNumber > 1 && remainingMs <= 0) break;

    threw = false;
    try {
      const result = await attempt({ tryNumber, remainingMs });
      lastResult = result;
      if (!options.shouldRetry(result, undefined)) return result;
    } catch (error) {
      threw = true;
      lastError = error;
      if (!options.shouldRetry(undefined, error)) throw error;
    }

    if (tryNumber === attempts) break;

    const delay = Math.min(maxDelayMs, baseDelayMs * factor ** (tryNumber - 1));
    if (now() + delay >= startedAt + deadlineMs) break;

    options.onRetry?.({ attempt: tryNumber, delayMs: delay, error: threw ? lastError : undefined });
    await sleep(delay);
  }

  if (threw) throw lastError;
  return lastResult as T;
}

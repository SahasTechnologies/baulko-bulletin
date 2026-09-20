import { test } from "node:test";
import assert from "node:assert/strict";
import { retryWithBackoff } from "./retry.ts";

/** A sleep that records the delay instead of waiting for it. */
function recorder() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

test("retryWithBackoff does not wait when the first try works", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls++;
      return "ok";
    },
    { shouldRetry: () => false, sleep }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("retryWithBackoff backs off between tries and reports each wait", async () => {
  const { delays, sleep } = recorder();
  const waits: number[] = [];
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls++;
      return calls < 3 ? { ok: false } : { ok: true };
    },
    {
      shouldRetry: (result) => result?.ok === false,
      sleep,
      onRetry: ({ delayMs }) => waits.push(delayMs),
    }
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [300, 900]);
  assert.deepEqual(waits, [300, 900]);
});

test("retryWithBackoff returns the last failure once the attempts run out", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls++;
      return { ok: false, error: `attempt ${calls}` };
    },
    { attempts: 3, shouldRetry: (result) => result?.ok === false, sleep }
  );
  assert.deepEqual(result, { ok: false, error: "attempt 3" });
  assert.deepEqual(delays, [300, 900]);
});

test("retryWithBackoff stops as soon as the outcome is not retryable", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls++;
      return { status: 422 };
    },
    { shouldRetry: (result) => (result?.status ?? 0) >= 500, sleep }
  );
  assert.deepEqual(result, { status: 422 });
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("retryWithBackoff retries a thrown error, then re-throws the last one", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls++;
        throw new Error(`network ${calls}`);
      },
      { attempts: 2, shouldRetry: (_result, error) => error instanceof Error, sleep }
    ),
    /network 2/
  );
  assert.equal(calls, 2);
  assert.deepEqual(delays, [300]);
});

test("retryWithBackoff never retries an error the caller calls final", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls++;
        throw new Error("bug");
      },
      { shouldRetry: () => false, sleep }
    ),
    /bug/
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("retryWithBackoff gives up when the next wait would pass the deadline", async () => {
  const { delays, sleep } = recorder();
  let clock = 0;
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls++;
      return { ok: false };
    },
    {
      attempts: 5,
      baseDelayMs: 400,
      factor: 3,
      deadlineMs: 1_000,
      shouldRetry: (result) => result?.ok === false,
      sleep: async (ms) => {
        clock += ms;
        await sleep(ms);
      },
      now: () => clock,
    }
  );
  // 400ms fits, 1200ms would land at 1600ms and does not.
  assert.deepEqual(delays, [400]);
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: false });
});

test("retryWithBackoff hands each try what is left of the deadline", async () => {
  const { sleep } = recorder();
  let clock = 0;
  const budgets: number[] = [];
  await retryWithBackoff(
    async ({ remainingMs }) => {
      budgets.push(remainingMs);
      // Each attempt spends part of the budget, as a real request would.
      clock += 500;
      return { ok: false };
    },
    {
      attempts: 4,
      baseDelayMs: 100,
      factor: 2,
      deadlineMs: 2_000,
      shouldRetry: (result) => result?.ok === false,
      sleep,
      now: () => clock,
    }
  );
  // The injected sleep does not move the clock, so only the attempts spend the
  // budget: 500ms each, from 2 000ms down until none is left.
  assert.deepEqual(budgets, [2_000, 1_500, 1_000, 500]);
});

test("retryWithBackoff stops starting attempts once the deadline has passed", async () => {
  const { delays, sleep } = recorder();
  let clock = 0;
  let calls = 0;
  await retryWithBackoff(
    async () => {
      calls++;
      clock += 900;
      return { ok: false };
    },
    {
      attempts: 10,
      baseDelayMs: 50,
      deadlineMs: 1_000,
      shouldRetry: (result) => result?.ok === false,
      sleep,
      now: () => clock,
    }
  );
  // Two attempts spend 1 800ms between them, so the third never starts.
  assert.equal(calls, 2);
  assert.deepEqual(delays, [50]);
});

test("retryWithBackoff caps the delay and always tries at least once", async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await retryWithBackoff(
    async () => {
      calls++;
      return "never good";
    },
    { attempts: 4, baseDelayMs: 500, factor: 10, maxDelayMs: 800, shouldRetry: () => true, sleep }
  );
  assert.equal(calls, 4);
  assert.deepEqual(delays, [500, 800, 800]);

  const single = recorder();
  await retryWithBackoff(async () => "once", { attempts: 0, shouldRetry: () => true, sleep: single.sleep });
  assert.deepEqual(single.delays, []);
});

/**
 * Postgres can settle two transactions racing for one slot with a DEADLOCK
 * (40P01) instead of the exclusion-constraint violation (23P01): each insert
 * waits to see whether the other's conflicting row commits. Postgres aborts one
 * of them, and its booking is safely gone, but without this the patient got a
 * server error instead of "that time was just taken" (finding F4, Phase 9).
 *
 * Retrying the aborted transaction is the standard fix: by then the winner has
 * committed, so the retry fails cleanly with 23P01 and the caller's normal
 * "slot taken" path answers. Only deadlocks are retried, a few times at most.
 */
export function isDeadlock(error: unknown) {
  const e = ((error as { cause?: unknown })?.cause ?? error) as { code?: string };
  return e?.code === "40P01";
}

export async function retryOnDeadlock<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isDeadlock(error) || attempt >= attempts) throw error;
    }
  }
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number; factor: number },
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > opts.retries) {
        throw error;
      }
      const delay = opts.baseDelayMs * Math.pow(opts.factor, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

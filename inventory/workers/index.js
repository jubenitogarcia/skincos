// Thin entrypoint for Cloudflare Workers.
// Keeps Durable Object exports intact while delegating implementation to src/.

export { RateLimiter, JobQueue } from '../src/worker.js';
import worker from '../src/worker.js';
export default worker;

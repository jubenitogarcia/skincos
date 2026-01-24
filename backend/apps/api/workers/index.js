// Thin entrypoint for Cloudflare Workers.
// Keeps Durable Object exports intact while sharing implementation with insumos.

export { RateLimiter, JobQueue } from '../../insumos/src/worker.js';
import worker from '../../insumos/src/worker.js';
export default worker;


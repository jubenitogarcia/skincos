export { RateLimiter, JobQueue } from './legacy-inventory-durable-objects.js';
import { handleGatewayRequest } from '../src/gateway.js';

export default {
    fetch(request, env, ctx) {
        return handleGatewayRequest(request, env, ctx);
    },
};

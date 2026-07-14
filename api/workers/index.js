export { RateLimiter, JobQueue } from '../../inventory/src/worker.js';
import { handleGatewayRequest } from '../src/gateway.js';

export default {
    fetch(request, env, ctx) {
        return handleGatewayRequest(request, env, ctx);
    },
};

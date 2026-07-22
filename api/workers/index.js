export { RateLimiter, JobQueue } from '../../inventory/src/worker.js';
import inventoryWorker from '../../inventory/src/worker.js';
import { createApiGateway } from '../src/gateway.js';

const handleGatewayRequest = createApiGateway({ inventoryHandler: inventoryWorker.fetch.bind(inventoryWorker) });

export default {
    fetch(request, env, ctx) {
        return handleGatewayRequest(request, env, ctx);
    },
};

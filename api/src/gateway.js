import inventoryWorker from '../../inventory/src/worker.js';
import { createGatewayHandler } from './router.js';

export { createGatewayHandler } from './router.js';

export const handleGatewayRequest = createGatewayHandler({
    inventoryHandler: inventoryWorker.fetch.bind(inventoryWorker),
});

// Compatibility mount. Identity owns the implementation while Inventory keeps
// the existing /auth/* route until the Identity Worker service is promoted.
export { handleAuthRoutes, createIdentityD1Store } from '../../../shared/identity-runtime/inventory-auth.js';

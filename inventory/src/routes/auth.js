// Compatibility mount. Identity owns the implementation while Inventory keeps
// the existing /auth/* route until the Identity Worker service is promoted.
export { handleAuthRoutes } from '../../../identity/routes/auth.js';
export { createIdentityD1Store } from '../../../identity/store/d1.js';

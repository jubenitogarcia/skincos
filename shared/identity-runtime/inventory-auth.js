// Inventory remains the HTTP compatibility host for /auth/*. It does not own
// users, session validation, invitation policy, or password recovery anymore.
export { handleAuthRoutes } from '../../identity/routes/auth.js';
export { createIdentityD1Store } from '../../identity/store/d1.js';

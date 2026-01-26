// Replit Auth Integration: OpenID Connect authentication setup (JavaScript)
import * as client from "openid-client";
import { Strategy } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage.js";

// Environment variables validation will be done in setupAuth() to prevent server crashes

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession(useMemoryStore = false) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  
  let sessionStore;
  if (useMemoryStore) {
    // NO_AUTH MODE: Use memory store instead of PostgreSQL
    console.log('🔓 NO_AUTH MODE: Using memory-based session store (no database dependency)');
    sessionStore = undefined; // Default memory store
  } else {
    // PRODUCTION MODE: Use PostgreSQL session store
    const pgStore = connectPg(session);
    sessionStore = new pgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true, // Allow table creation if missing
      ttl: sessionTtl,
      tableName: "sessions",
    });
  }
  
  const secret = useMemoryStore ? 'dev-only-memory-secret' : process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is required when NO_AUTH is disabled');
  }

  return session({
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Only secure in production
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(user, tokens) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app) {
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';
  const NO_AUTH_REQUESTED = process.env.NO_AUTH === 'true';
  const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

  try {
    // ===== PRODUCTION SAFETY CHECK =====
    // NO_AUTH is NEVER allowed in production, regardless of NO_AUTH setting
    
    if (IS_PRODUCTION && NO_AUTH_REQUESTED) {
      console.warn('🚫 PRODUCTION SAFETY: NO_AUTH=true is set but NODE_ENV=production');
      console.warn('🚫 NO_AUTH mode is DISABLED for security in production environment');
      console.warn('🚫 If you need to test auth, use NODE_ENV=development instead');
    }

    // ===== NO_AUTH MODE FOR DEVELOPMENT ONLY =====
    // Skip all authentication setup if NO_AUTH mode is enabled AND not in production
    if (!IS_PRODUCTION && (NO_AUTH_REQUESTED || IS_DEVELOPMENT)) {
      console.log('🔓 NO_AUTH MODE ENABLED - Setting up mock authentication for development');
      console.log('🔓 To re-enable real auth, set NO_AUTH=false or NODE_ENV=production');
      
      // NO_AUTH MODE: Set up memory-based session (no database dependency)
      app.use(getSession(true));
      
      // NO_AUTH MODE: Mock authentication middleware - sets req.user and req.isAuthenticated
      app.use((req, res, next) => {
        // Mock authenticated user for development
        req.user = {
          claims: {
            sub: 'dev-user-123',
            email: 'dev@localhost',
            first_name: 'Dev',
            last_name: 'User',
            profile_image_url: null
          },
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 86400 // 24 hours from now
        };
        
        // Mock isAuthenticated function
        req.isAuthenticated = () => true;
        
        next();
      });
      
      // NO_AUTH MODE: Mock authentication routes that respond successfully
      app.get("/api/login", (req, res) => {
        console.log('🔓 NO_AUTH MODE: Mock login route accessed');
        res.json({ 
          success: true, 
          message: 'Mock authentication successful',
          user: req.user 
        });
      });
      
      app.get("/api/callback", (req, res) => {
        console.log('🔓 NO_AUTH MODE: Mock callback route accessed');
        res.redirect('/');
      });
      
      app.get("/api/logout", (req, res) => {
        console.log('🔓 NO_AUTH MODE: Mock logout route accessed');
        res.json({ 
          success: true, 
          message: 'Mock logout successful' 
        });
      });
      
      console.log('✅ NO_AUTH MODE: Mock authentication setup completed');
      return;
    }

    if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
      throw new Error('SESSION_SECRET is required in production');
    }

    // Validate required environment variables
    if (!process.env.REPLIT_DOMAINS) {
      console.warn("⚠️  REPLIT_DOMAINS not set - Replit Auth disabled");
      return;
    }

    if (!process.env.REPL_ID) {
      console.warn("⚠️  REPL_ID not set - Replit Auth disabled");
      return;
    }

    app.set("trust proxy", 1);
    app.use(getSession());
    app.use(passport.initialize());
    app.use(passport.session());

    const config = await getOidcConfig();

    const verify = async (tokens, verified) => {
      const user = {};
      updateUserSession(user, tokens);
      try {
        await upsertUser(tokens.claims());
      } catch (error) {
        console.warn("⚠️  Failed to upsert user, continuing anyway:", error.message);
      }
      verified(null, user);
    };

    // Register Replit domain strategies only
    const domains = process.env.REPLIT_DOMAINS.split(",");

    for (const domain of domains) {
      const strategy = new Strategy(
        {
          name: `replitauth:${domain}`,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`, // Always HTTPS for Replit domains
        },
        verify,
      );
      passport.use(strategy);
      
      console.log(`📋 Registered auth strategy: replitauth:${domain}`);
      console.log(`🔗 Callback URL: https://${domain}/api/callback`);
    }
    
    console.log(`✅ OAuth configured for ${domains.length} domain(s): ${domains.join(', ')}`);
    console.log(`🔄 Localhost requests will be redirected to: ${domains[0]}`);

    passport.serializeUser((user, cb) => cb(null, user));
    passport.deserializeUser((user, cb) => cb(null, user));

    app.get("/api/login", (req, res, next) => {
      // Force redirect to public domain for consistent OAuth flow
      const publicDomain = domains[0]; // Use the first Replit domain
      
      // DISABLED: Localhost redirect in development to prevent connection issues
      // Development should work directly on localhost without forced redirects
      if (false && req.hostname === 'localhost') {
        console.log(`🔄 Redirecting localhost to public domain for OAuth consistency`);
        console.log(`🌐 Public domain: ${publicDomain}`);
        return res.redirect(`https://${publicDomain}/api/login`);
      }
      
      // Fallback for localhost development without OAuth
      if (req.hostname === 'localhost' || req.hostname === '0.0.0.0') {
        console.log(`🔐 Localhost detected - using mock authentication for development`);
        
        // Create a mock authenticated session for development
        const mockUser = {
          claims: {
            sub: 'dev-user-123',
            email: 'dev@localhost',
            first_name: 'Dev',
            last_name: 'User'
          },
          expires_at: Math.floor(Date.now() / 1000) + 86400 // 24 hours from now
        };
        
        req.logIn(mockUser, (err) => {
          if (err) {
            console.error("❌ Mock login error:", err);
            return res.status(500).json({ error: 'Mock authentication failed' });
          }
          console.log("✅ Mock user authenticated for development");
          res.redirect('/');
        });
        return;
      }
      
      const strategyName = `replitauth:${req.hostname}`;
      console.log(`🔐 Login request from hostname: ${req.hostname}`);
      console.log(`🎯 Using OAuth strategy: ${strategyName}`);
      
      passport.authenticate(strategyName, {
        prompt: "login consent",
        scope: ["openid", "email", "profile", "offline_access"],
      })(req, res, next);
    });

    app.get("/api/callback", (req, res, next) => {
      console.log(`🚀 OAuth Callback received - Hostname: ${req.hostname}, URL: ${req.url}`);
      console.log(`📊 Query params:`, req.query);
      
      // Use the correct strategy based on the actual hostname in the callback
      const strategyName = `replitauth:${req.hostname}`;
      console.log(`🔍 Strategy to use: ${strategyName}`);
      
      passport.authenticate(strategyName, (err, user, info) => {
        console.log(`🔍 Passport authenticate callback - Error: ${err}, User: ${!!user}, Info:`, info);
        
        if (err) {
          console.error("❌ Auth callback error:", err);
          return res.redirect("/api/login");
        }
        
        if (!user) {
          console.warn("⚠️  Auth callback: no user found");
          console.warn("📋 Available strategies:", Object.keys(passport._strategies || {}));
          console.warn("🔍 Used strategy:", strategyName);
          return res.redirect("/api/login");
        }

        console.log("👤 User object received:", { 
          hasUser: !!user, 
          userKeys: Object.keys(user || {}),
          expires_at: user?.expires_at 
        });

        req.logIn(user, (err) => {
          if (err) {
            console.error("❌ Login error:", err);
            return res.redirect("/api/login");
          }
          
          console.log("✅ User successfully authenticated and logged in");
          
          // Redirect to the main frontend app (Replit public domain without port)
          const redirectUrl = `https://${req.hostname}/`;
          console.log(`🔗 Redirecting to: ${redirectUrl}`);
          res.redirect(redirectUrl);
        });
      })(req, res, next);
    });

    app.get("/api/logout", (req, res) => {
      req.logout(() => {
        res.redirect(
          client.buildEndSessionUrl(config, {
            client_id: process.env.REPL_ID,
            post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
          }).href
        );
      });
    });

    console.log("✅ Replit Auth configured successfully");
  } catch (error) {
    console.warn("⚠️  Replit Auth setup failed:", error.message);
    if (IS_PRODUCTION) throw error;
  }
}

export const isAuthenticated = async (req, res, next) => {
  // ===== PRODUCTION SAFETY CHECK =====
  // NO_AUTH is NEVER allowed in production, regardless of NO_AUTH setting
  const IS_PRODUCTION = process.env.NODE_ENV === 'production';
  const NO_AUTH_REQUESTED = process.env.NO_AUTH === 'true';
  const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';
  
  // ===== NO_AUTH MODE FOR DEVELOPMENT ONLY =====
  // Skip all authentication checks if NO_AUTH mode is enabled AND not in production
  if (!IS_PRODUCTION && (NO_AUTH_REQUESTED || IS_DEVELOPMENT)) {
    console.log('🔓 NO_AUTH MODE - Bypassing authentication middleware');
    return next();
  }

  const user = req.user;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};

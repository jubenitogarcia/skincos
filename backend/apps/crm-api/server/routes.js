// Replit Auth Integration: Authentication routes and middleware
import { storage } from "./storage.js";
import { setupAuth, isAuthenticated } from "./replitAuth.js";

export async function registerAuthRoutes(app) {
  // Setup Auth middleware
  await setupAuth(app);

  // Auth endpoint to get current user
  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        id: user.id,
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email?.split('@')[0] || 'Usuario',
        createdAt: user.createdAt,
        avatarUrl: user.profileImageUrl || null
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Protected route example - Health check for authenticated users  
  app.get("/api/auth/health", isAuthenticated, (req, res) => {
    res.json({ 
      message: "Authenticated successfully", 
      userId: req.user?.claims?.sub,
      timestamp: new Date().toISOString()
    });
  });
}
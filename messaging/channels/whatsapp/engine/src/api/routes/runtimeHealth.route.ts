import { Express, Request, Response } from 'express';

/**
 * A dependency-free listener probe for the runtime supervisor and watchdog.
 * It intentionally does not disclose configuration, connection state or secrets.
 */
export function registerRuntimeHealthRoute(app: Express) {
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'messaging-whatsapp' });
  });
}

import { RouterBroker } from '@api/abstract/abstract.router';
import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'path';

const managerViewRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export class ViewsRouter extends RouterBroker {
  public readonly router: Router;

  constructor() {
    super();
    this.router = Router();

    const basePath = path.join(process.cwd(), 'manager', 'dist');
    const indexPath = path.join(basePath, 'index.html');

    this.router.use(managerViewRateLimit, express.static(basePath));

    this.router.get('*', managerViewRateLimit, (req, res) => {
      res.sendFile(indexPath);
    });
  }
}

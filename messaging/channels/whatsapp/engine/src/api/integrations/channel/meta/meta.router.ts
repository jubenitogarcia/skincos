import { RouterBroker } from '@api/abstract/abstract.router';
import { metaController } from '@api/server.module';
import { ConfigService, WaBusiness } from '@config/env.config';
import { constantTimeTokenMatch, validMetaChallenge } from '@utils/metaWebhookVerification';
import { Router } from 'express';

export class MetaRouter extends RouterBroker {
  constructor(readonly configService: ConfigService) {
    super();
    this.router
      .get(this.routerPath('webhook/meta', false), async (req, res) => {
        const challenge = req.query['hub.challenge'];
        const expectedToken = configService.get<WaBusiness>('WA_BUSINESS').TOKEN_WEBHOOK;
        if (!constantTimeTokenMatch(req.query['hub.verify_token'], expectedToken) || !validMetaChallenge(challenge)) {
          return res.status(403).type('text/plain').send('Invalid webhook verification');
        }
        return res.status(200).type('text/plain').send(challenge);
      })
      .post(this.routerPath('webhook/meta', false), async (req, res) => {
        const { body } = req;
        const response = await metaController.receiveWebhook(body);

        return res.status(200).json(response);
      });
  }

  public readonly router: Router = Router();
}

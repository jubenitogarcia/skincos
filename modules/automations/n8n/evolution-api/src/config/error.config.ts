import { Logger } from './logger.config';

export function onUnexpectedError() {
  const limits = {
    decrypt: parseInt(process.env.LOG_DECRYPT_ERRORS_LIMIT || '50'),
  };
  let counters = {
    decrypt: 0,
    windowStart: Date.now(),
  };

  const shouldRateLimitDecrypt = (msg: string) => {
    const patterns = ['Bad MAC', 'MessageCounterError', 'No matching sessions found', 'Key used already'];
    return patterns.some((p) => msg.includes(p));
  };

  const withinWindow = () => Date.now() - counters.windowStart < 60_000;
  const resetWindow = () => {
    counters.windowStart = Date.now();
    counters.decrypt = 0;
  };

  process.on('uncaughtException', (error, origin) => {
    const logger = new Logger('uncaughtException');
    if (!withinWindow()) resetWindow();
    const msg = error?.toString() || '';
    if (shouldRateLimitDecrypt(msg)) {
      if (counters.decrypt < limits.decrypt) {
        counters.decrypt++;
        logger.error({ origin, stderr: process.stderr.fd, error });
      } else if (counters.decrypt === limits.decrypt) {
        counters.decrypt++;
        logger.warn('Decrypt error flood suppressed (limit reached)');
      }
      return;
    }
    logger.error({ origin, stderr: process.stderr.fd, error });
  });

  process.on('unhandledRejection', (error: any, origin) => {
    const logger = new Logger('unhandledRejection');
    if (!withinWindow()) resetWindow();
    const msg = (error && (error.message || error.toString())) || '';
    if (shouldRateLimitDecrypt(msg)) {
      if (counters.decrypt < limits.decrypt) {
        counters.decrypt++;
        logger.error({ origin, stderr: process.stderr.fd });
        logger.error(error);
      } else if (counters.decrypt === limits.decrypt) {
        counters.decrypt++;
        logger.warn('Decrypt error flood suppressed (limit reached)');
      }
      return;
    }
    logger.error({ origin, stderr: process.stderr.fd });
    logger.error(error);
  });
}

from __future__ import annotations
import asyncio
import json
import logging
import time
from typing import Any

from config import get_settings
from services.classifier import classifier
from services.whatsapp_client import client as waclient
from metrics import events_processed_total, processing_latency, events_intent_total
from debug_state import add_reply

logger = logging.getLogger("message_worker")
settings = get_settings()

class MessageWorker:
    def __init__(self, queue, dedupe_store=None) -> None:
        self.queue = queue
        self.dedupe_store = dedupe_store
        self._stopping = False

    async def start(self):
        logger.info("MessageWorker start loop backend=%s", settings.queue_backend)
        while not self._stopping:
            try:
                item = None
                if settings.queue_backend == 'redis':
                    item = self.queue.pop(timeout=5)  # brpop
                else:
                    await asyncio.sleep(1)
                    continue  # memory worker já existente separado
                if not item:
                    continue
                start = time.time()
                await self.process(item)
                if processing_latency:
                    processing_latency.observe(time.time() - start)
            except Exception as e:  # pragma: no cover
                logger.exception("Loop error: %s", e)
                await asyncio.sleep(2)

    async def process(self, item: dict):
        attempt = int(item.get('attempt', 0))
        payload = item.get('payload') or {}
        msg = payload.get('message') or {}
        text = msg.get('body', '')
        event_type = item.get('event_type') or payload.get('event')
        # Só respondemos a mensagens realmente recebidas do usuário final
        if event_type and event_type != 'message_received':
            logger.debug("Skipping non-inbound event_type=%s id=%s", event_type, msg.get('id'))
            return
        # Ignorar mensagens do próprio bot (se gateway marca) ou eco do próprio default
        if msg.get('fromMe') is True or str(msg.get('id','')).startswith('true_'):
            logger.debug("Ignoring self/outbound message id=%s", msg.get('id'))
            if events_processed_total:
                events_processed_total.labels(status='ignored').inc()
            return
        if not text or not text.strip():
            logger.debug("Ignoring empty text message id=%s", msg.get('id'))
            if events_processed_total:
                events_processed_total.labels(status='ignored').inc()
            return
        classification = classifier.classify(text)
        logger.debug(
            "Processing message id=%s attempt=%s intent=%s text_len=%s",
            msg.get('id'), attempt, classification['intent'], len(text)
        )
        to_val = msg.get('from')
        to: str = str(to_val) if to_val else ''
        if not to:
            # Evita tentativas inúteis de envio para destino vazio (pode ocorrer em eventos sem campo 'from')
            logger.warning("Ignoring message without 'from' field id=%s event_type=%s", msg.get('id'), event_type)
            if events_processed_total:
                events_processed_total.labels(status='ignored').inc()
            return
        reply = settings.intent_default_reply
        intent = classification['intent']
        if intent == 'greeting':
            reply = 'Olá! Como posso ajudar?'
        elif intent == 'order_status':
            reply = 'Seu pedido está em processamento ✅'
        elif intent == 'bot_identity':
            reply = 'Sou o Agent Zero, seu assistente. Pode me perguntar sobre status de pedido ou dizer oi.'
        # Evitar loop: se intent unknown e mensagem já é igual ao default, não responder de novo
        elif intent == 'unknown' and text.strip() == settings.intent_default_reply:
            logger.debug("Skipping reply to own default text id=%s", msg.get('id'))
            if events_processed_total:
                events_processed_total.labels(status='ignored').inc()
            return
        ok = await waclient.send_message(to, reply)
        logger.info(
            "Reply dispatch to=%s ok=%s original_id=%s intent=%s text='%s' reply='%s' attempt=%s",
            to, ok, msg.get('id'), intent, text[:120], reply[:120], attempt
        )
        try:
            add_reply({
                'ok': ok,
                'to': to,
                'original_message_id': msg.get('id'),
                'intent': intent,
                'reply': reply,
                'text': text,
                'attempt': attempt
            })
        except Exception:  # pragma: no cover
            pass
        if events_processed_total:
            events_processed_total.labels(status='success' if ok else 'fail').inc()
        if events_intent_total:
            events_intent_total.labels(intent=intent).inc()
        if ok:
            try:
                await waclient.annotate(
                    msg.get('id', ''), {"intent": intent, "confidence": classification['confidence']}
                )
            except Exception:  # pragma: no cover
                pass
            if settings.queue_backend == 'redis':
                try:
                    self.queue.client.incr('stats:processed_success')  # type: ignore[attr-defined]
                except Exception:
                    pass
        else:
            if attempt + 1 < settings.worker_max_attempts:
                backoff = 2 ** attempt * 2
                logger.warning(
                    "Retrying message id=%s next_attempt=%s backoff=%ss", msg.get('id'), attempt + 1, backoff
                )
                await asyncio.sleep(backoff)
                item['attempt'] = attempt + 1
                if settings.queue_backend == 'redis':
                    self.queue.put(item)
            else:
                logger.error(
                    "Mensagem falhou após %s tentativas id=%s", attempt + 1, msg.get('id')
                )
                if settings.queue_backend == 'redis':
                    try:
                        self.queue.client.incr('stats:processed_failed')  # type: ignore[attr-defined]
                    except Exception:
                        pass

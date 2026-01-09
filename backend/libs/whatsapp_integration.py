"""
Compat shim for legacy imports.

Prefer `from libs.whatsapp import WhatsAppClient, MessageSender`.
"""

from libs.whatsapp import MessageSender, WhatsAppClient

__all__ = ["WhatsAppClient", "MessageSender"]


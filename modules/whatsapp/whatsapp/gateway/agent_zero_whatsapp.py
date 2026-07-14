"""
Agent-Zero WhatsApp Integration Module

Este módulo fornece uma interface Python para o Agent-Zero interagir
com a automação WhatsApp via API REST.

Uso básico:
    from agent_zero_whatsapp import AgentZeroWhatsApp

    whatsapp = AgentZeroWhatsApp()
    whatsapp.notify_admin("Agent-Zero está funcionando!")
"""

import requests
import json
import logging
from datetime import datetime
from typing import Optional, Dict, List, Union
import time

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WhatsAppError(Exception):
    """Exceção customizada para erros do WhatsApp"""
    pass

class AgentZeroWhatsApp:
    """
    Classe principal para integração Agent-Zero + WhatsApp

    Fornece métodos para envio de mensagens, alertas e relatórios
    via WhatsApp usando a API REST local.
    """

    def __init__(self,
                 api_base: str = "http://localhost:3001",
                 admin_number: str = "5551995103563",
                 timeout: int = 10,
                 max_retries: int = 3):
        """
        Inicializa a integração WhatsApp

        Args:
            api_base: URL base da API WhatsApp
            admin_number: Número do administrador (sem +)
            timeout: Timeout para requests HTTP
            max_retries: Máximo de tentativas em caso de erro
        """
        self.api_base = api_base.rstrip('/')
        self.admin_number = admin_number
        self.timeout = timeout
        self.max_retries = max_retries

        logger.info(f"AgentZeroWhatsApp inicializado: {api_base}")

    def _make_request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        """
        Faz requisição HTTP com retry automático

        Args:
            method: GET, POST, etc.
            endpoint: Endpoint da API
            data: Dados para POST

        Returns:
            Resposta JSON da API

        Raises:
            WhatsAppError: Em caso de erro persistente
        """
        url = f"{self.api_base}{endpoint}"

        for attempt in range(self.max_retries):
            try:
                if method.upper() == 'GET':
                    response = requests.get(url, timeout=self.timeout)
                elif method.upper() == 'POST':
                    response = requests.post(url, json=data, timeout=self.timeout)
                else:
                    raise ValueError(f"Método HTTP não suportado: {method}")

                response.raise_for_status()
                return response.json()

            except requests.exceptions.RequestException as e:
                logger.warning(f"Tentativa {attempt + 1}/{self.max_retries} falhou: {e}")
                if attempt == self.max_retries - 1:
                    raise WhatsAppError(f"Falha na comunicação com WhatsApp API: {e}")
                time.sleep(1)  # Aguardar antes de tentar novamente

    def is_ready(self) -> bool:
        """
        Verifica se o WhatsApp está pronto para uso

        Returns:
            True se pronto, False caso contrário
        """
        try:
            response = self._make_request('GET', '/status')
            is_ready = response.get('status') == 'ready'
            logger.info(f"WhatsApp status: {'pronto' if is_ready else 'não pronto'}")
            return is_ready
        except Exception as e:
            logger.error(f"Erro ao verificar status: {e}")
            return False

    def wait_ready(self, max_wait: int = 60) -> bool:
        """
        Aguarda o WhatsApp ficar pronto

        Args:
            max_wait: Tempo máximo de espera em segundos

        Returns:
            True se ficou pronto, False se timeout
        """
        start_time = time.time()
        logger.info("Aguardando WhatsApp ficar pronto...")

        while time.time() - start_time < max_wait:
            if self.is_ready():
                logger.info("WhatsApp está pronto!")
                return True
            time.sleep(2)

        logger.warning(f"Timeout após {max_wait}s aguardando WhatsApp")
        return False

    def send_message(self, number: str, message: str) -> Dict:
        """
        Envia mensagem para número específico

        Args:
            number: Número de destino (formato: 5511999999999)
            message: Texto da mensagem

        Returns:
            Resposta da API com status do envio
        """
        if not self.is_ready():
            logger.error("WhatsApp não está pronto")
            return {"success": False, "error": "WhatsApp não está pronto"}

        try:
            response = self._make_request('POST', '/send', {
                "number": number,
                "message": message
            })

            if response.get('success'):
                logger.info(f"Mensagem enviada para {number[:4]}****{number[-4:]}")
            else:
                logger.error(f"Falha ao enviar mensagem: {response.get('message')}")

            return response

        except Exception as e:
            logger.error(f"Erro ao enviar mensagem: {e}")
            return {"success": False, "error": str(e)}

    def notify_admin(self, message: str) -> Dict:
        """
        Envia mensagem para o administrador

        Args:
            message: Texto da mensagem

        Returns:
            Resposta da API
        """
        return self.send_message(self.admin_number, message)

    def send_alert(self,
                   title: str,
                   details: str,
                   priority: str = "normal",
                   include_timestamp: bool = True) -> Dict:
        """
        Envia alerta formatado

        Args:
            title: Título do alerta
            details: Detalhes do problema
            priority: Prioridade (low, normal, high, critical)
            include_timestamp: Se deve incluir timestamp

        Returns:
            Resposta da API
        """
        # Emojis por prioridade
        emojis = {
            "low": "ℹ️",
            "normal": "⚠️",
            "high": "🚨",
            "critical": "🔥"
        }

        emoji = emojis.get(priority, "📢")

        alert_msg = f"{emoji} *{title}*\n\n"
        alert_msg += f"{details}\n"

        if include_timestamp:
            alert_msg += f"\n🕐 {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"

        alert_msg += f"\n🤖 Agent-Zero Alert"

        logger.info(f"Enviando alerta [{priority}]: {title}")
        return self.notify_admin(alert_msg)

    def send_report(self,
                    title: str,
                    data: Dict,
                    include_summary: bool = True) -> Dict:
        """
        Envia relatório estruturado

        Args:
            title: Título do relatório
            data: Dados do relatório (dict)
            include_summary: Se deve incluir resumo

        Returns:
            Resposta da API
        """
        report = f"📊 *{title}*\n\n"

        # Adicionar dados
        for key, value in data.items():
            # Formatação especial para números
            if isinstance(value, float):
                value = f"{value:.2f}"
            report += f"• {key}: {value}\n"

        if include_summary:
            report += f"\n📈 Total de itens: {len(data)}"

        report += f"\n🕐 {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"
        report += f"\n🤖 Agent-Zero Report"

        logger.info(f"Enviando relatório: {title}")
        return self.notify_admin(report)

    def send_system_status(self,
                          status: str,
                          uptime: Optional[str] = None,
                          metrics: Optional[Dict] = None) -> Dict:
        """
        Envia status do sistema

        Args:
            status: Status atual (online, offline, error, etc.)
            uptime: Tempo de funcionamento
            metrics: Métricas do sistema

        Returns:
            Resposta da API
        """
        status_emojis = {
            "online": "✅",
            "offline": "❌",
            "error": "🚨",
            "warning": "⚠️",
            "maintenance": "🔧"
        }

        emoji = status_emojis.get(status.lower(), "📊")

        msg = f"{emoji} *Agent-Zero Status*\n\n"
        msg += f"🔄 Status: {status.upper()}\n"

        if uptime:
            msg += f"⏱️ Uptime: {uptime}\n"

        if metrics:
            msg += f"\n📊 *Métricas:*\n"
            for key, value in metrics.items():
                msg += f"• {key}: {value}\n"

        msg += f"\n🕐 {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"

        logger.info(f"Enviando status do sistema: {status}")
        return self.notify_admin(msg)

    def get_chats(self) -> List[Dict]:
        """
        Obtém lista de chats disponíveis

        Returns:
            Lista de chats com informações
        """
        try:
            response = self._make_request('GET', '/chats')
            chats = response.get('chats', [])
            logger.info(f"Obtidos {len(chats)} chats")
            return chats
        except Exception as e:
            logger.error(f"Erro ao obter chats: {e}")
            return []

    def send_webhook(self,
                     target: str,
                     message: str,
                     data: Optional[Dict] = None) -> Dict:
        """
        Envia webhook com dados estruturados

        Args:
            target: Número de destino
            message: Mensagem principal
            data: Dados adicionais (opcional)

        Returns:
            Resposta da API
        """
        try:
            payload = {
                "target": target,
                "message": message
            }

            if data:
                payload["data"] = data

            response = self._make_request('POST', '/webhook', payload)
            logger.info(f"Webhook enviado para {target[:4]}****{target[-4:]}")
            return response

        except Exception as e:
            logger.error(f"Erro ao enviar webhook: {e}")
            return {"success": False, "error": str(e)}

    def get_status_info(self) -> Dict:
        """
        Obtém informações detalhadas do status

        Returns:
            Informações completas do status
        """
        try:
            return self._make_request('GET', '/status')
        except Exception as e:
            logger.error(f"Erro ao obter status: {e}")
            return {"status": "error", "message": str(e)}

# Instância global para facilitar uso
whatsapp = AgentZeroWhatsApp()

# Funções de conveniência
def notify(message: str) -> Dict:
    """Função de conveniência para notificação rápida"""
    return whatsapp.notify_admin(message)

def alert(title: str, details: str, priority: str = "normal") -> Dict:
    """Função de conveniência para alertas"""
    return whatsapp.send_alert(title, details, priority)

def report(title: str, data: Dict) -> Dict:
    """Função de conveniência para relatórios"""
    return whatsapp.send_report(title, data)

def system_status(status: str, **kwargs) -> Dict:
    """Função de conveniência para status do sistema"""
    return whatsapp.send_system_status(status, **kwargs)

# Exemplo de uso
if __name__ == "__main__":
    # Teste básico
    print("🧪 Testando integração Agent-Zero + WhatsApp...")

    # Verificar se está pronto
    if whatsapp.is_ready():
        print("✅ WhatsApp está pronto!")

        # Enviar notificação de teste
        result = notify("🧪 Teste de integração Agent-Zero + WhatsApp funcionando!")
        print(f"📤 Resultado: {result}")

        # Enviar alerta de teste
        alert("Teste de Alerta", "Este é um alerta de teste do Agent-Zero", "low")

        # Enviar relatório de teste
        report("Relatório de Teste", {
            "Status": "Funcionando",
            "Testes": "3/3",
            "Erro": "0"
        })

    else:
        print("❌ WhatsApp não está pronto")
        print("💡 Certifique-se de que bot_com_api.js está rodando e autenticado")

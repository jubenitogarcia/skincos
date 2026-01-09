"""
Serviço para integração com Agent-Zero para geração de frases motivacionais.
"""

import logging
import requests
from typing import Optional, Dict, Any, Union
from config import ConfigManager

logger = logging.getLogger(__name__)

def safe_float_convert(value: Any) -> float:
    """Converte um valor para float de forma segura"""
    try:
        if isinstance(value, str):
            # Remove formatação de moeda/número
            clean_value = value.replace('R$', '').replace(',', '').replace('.', '').strip()
            if clean_value:
                return float(clean_value) / 100  # Assumindo centavos
        return float(value) if value else 0.0
    except:
        return 0.0

class AgentZeroService:
    """Serviço para comunicação com Agent-Zero"""

    def __init__(self):
        config = ConfigManager.get_config()
        self.api_url = "https://a0.skincos.com.br"
        self.timeout = 30

    def generate_motivational_phrase(
        self,
        message_data: Dict[str, Any],
        chart_image_url: Optional[str] = None,
        period: str = "morning"
    ) -> str:
        """
        Gera frase motivacional usando Agent-Zero

        Args:
            message_data: Dados da mensagem (metas, valores, etc)
            chart_image_url: URL da imagem do gráfico
            period: Período da mensagem (morning/evening)

        Returns:
            Frase motivacional gerada
        """
        try:
            logger.info("🤖 Solicitando frase motivacional do Agent-Zero...")

            # Preparar mensagem para o agent
            message_text = self._prepare_message_text(message_data, chart_image_url, period)

            # Fazer requisição para o agent-zero usando endpoint correto
            response = self._make_request(message_text)

            if response and response.status_code == 200:
                result = response.json()
                motivational_phrase = result.get('message', '')
                if motivational_phrase:
                    logger.info(f"✅ Frase motivacional gerada: {motivational_phrase[:50]}...")
                    return motivational_phrase
                else:
                    logger.warning("⚠️ Agent-Zero retornou uma frase vazia")
            else:
                error_text = response.text if response else "N/A"
                status_code = response.status_code if response else "N/A"
                logger.error(f"❌ Agent-Zero HTTP {status_code}: {error_text[:200]}")

        except Exception as e:
            logger.error(f"❌ Erro ao gerar frase motivacional: {e}")

        logger.warning("⚠️ Usando frase de fallback")
        return self._get_fallback_phrase(period)

    def _prepare_message_text(self, message_data: Dict[str, Any], chart_image_url: Optional[str], period: str) -> str:
        """Prepara a mensagem de texto para enviar ao Agent-Zero"""

        team = message_data.get('team', 'Equipe')
        values = message_data.get('values', {})
        metas = message_data.get('metas_atingidas', {})

        # Converter valores para float
        sales_today = safe_float_convert(values.get('vendas_totais', '0'))
        sales_yesterday = safe_float_convert(values.get('vendas_ontem', '0'))

        # Construir contexto detalhado
        period_pt = "manhã" if period == "morning" else "noite"

        context = f"""Gere uma frase motivacional para a equipe {team} no período da {period_pt}.

Dados de performance:
- Vendas de hoje: R$ {sales_today:,.2f}
- Vendas de ontem: R$ {sales_yesterday:,.2f}

Status das metas:"""

        if metas:
            for meta, atingida in metas.items():
                status = "✅ ATINGIDA" if atingida else "❌ NÃO ATINGIDA"
                context += f"\n- {meta.replace('_', ' ').title()}: {status}"
        else:
            context += "\n- Nenhuma meta específica definida"

        if chart_image_url:
            context += f"\n\nGráfico de performance disponível: {chart_image_url}"

        context += f"""

Instruções:
- Gere uma frase motivacional em português brasileiro
- Tom: {period_pt == 'manhã' and 'encorajador para começar o dia' or 'reconhecimento pelos esforços do dia'}
- Tamanho: 1-2 frases curtas
- Inclua emojis apropriados
- Foque nos resultados e motive para as próximas vendas
- Seja específico sobre a performance da equipe"""

        logger.debug(f"📝 Mensagem preparada para Agent-Zero: {context[:200]}...")
        return context

    def _make_request(self, message_text: str) -> Optional[requests.Response]:
        """Faz requisição para o Agent-Zero usando a API correta"""

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "SKINCOS-AgentZero/1.0"
        }

        payload = {
            "text": message_text,
            "context": "motivational_sales"
        }

        try:
            logger.info(f"🌐 Enviando requisição para {self.api_url}/message")

            response = requests.post(
                f"{self.api_url}/message",
                json=payload,
                headers=headers,
                timeout=self.timeout
            )

            logger.info(f"📊 Agent-Zero Status: {response.status_code}")
            return response

        except requests.exceptions.Timeout:
            logger.error(f"⏰ Timeout ao conectar com Agent-Zero ({self.timeout}s)")
            return None
        except requests.exceptions.ConnectionError as e:
            logger.error(f"🔌 Erro de conexão com Agent-Zero: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ Erro inesperado na requisição: {e}")
            return None

    def _get_fallback_phrase(self, period: str) -> str:
        """Retorna frase motivacional de fallback"""

        fallback_phrases = {
            "morning": [
                "🌟 Vamos dar o nosso melhor hoje!",
                "💪 Cada venda nos aproxima do sucesso!",
                "🚀 Hoje é um novo dia para alcançarmos nossas metas!",
                "✨ Juntos somos mais fortes, vamos em frente!",
                "🎯 Foco e determinação para mais um dia de vitórias!"
            ],
            "evening": [
                "🌙 Parabéns pelo esforço de hoje!",
                "⭐ Cada resultado nos ensina e nos fortalece!",
                "🏆 Amanhã é uma nova oportunidade de brilhar!",
                "💫 O importante é nunca desistir dos nossos sonhos!",
                "🎊 Vamos descansar e voltar ainda mais fortes amanhã!"
            ]
        }

        phrases = fallback_phrases.get(period, fallback_phrases["morning"])

        # Usar primeira frase como padrão
        phrase = phrases[0]

        logger.info(f"🔄 Usando frase motivacional de fallback: {phrase}")
        return phrase

    def test_connection(self) -> bool:
        """Testa conexão com Agent-Zero"""
        try:
            logger.info("🧪 Testando conexão com Agent-Zero...")

            response = requests.get(
                f"{self.api_url}/health",
                headers={"Content-Type": "application/json"},
                timeout=10
            )

            if response.ok:
                logger.info("✅ Agent-Zero está respondendo")
                logger.debug(f"Health check response: {response.json()}")
                return True
            else:
                logger.warning(f"⚠️ Agent-Zero retornou {response.status_code}")
                return False

        except Exception as e:
            logger.error(f"❌ Erro ao testar Agent-Zero: {e}")
            return False

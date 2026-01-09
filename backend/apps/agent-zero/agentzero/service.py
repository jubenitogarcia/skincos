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
        """Faz requisição para o Agent-Zero usando CSRF token dinâmico"""

        try:
            logger.info(f"🌐 Iniciando sessão com {self.api_url}")

            # Criar sessão para manter cookies
            session = requests.Session()

            # 1. Obter CSRF token dinâmico
            logger.info("🔐 Obtendo CSRF token...")
            csrf_response = session.get(f"{self.api_url}/csrf_token", timeout=self.timeout)

            if csrf_response.status_code != 200:
                logger.error(f"❌ Erro ao obter CSRF token: {csrf_response.status_code}")
                return None

            csrf_data = csrf_response.json()
            token = csrf_data.get("token")
            runtime_id = csrf_data.get("runtime_id")

            if not token:
                logger.error("❌ Token CSRF não encontrado na resposta")
                return None

            logger.info(f"✅ CSRF token obtido: {token[:20]}... (runtime: {runtime_id})")

            # 2. Fazer requisição com token e sessão
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "SKINCOS-AgentZero/1.0",
                "X-CSRF-Token": token
            }

            payload = {
                "text": message_text,
                "context": "motivational_sales"
            }

            logger.info(f"� Enviando mensagem para {self.api_url}/message")
            response = session.post(
                f"{self.api_url}/message",
                json=payload,
                headers=headers,
                timeout=self.timeout
            )

            logger.info(f"📊 Agent-Zero Status: {response.status_code}")

            if response.status_code == 200:
                logger.info("✅ Requisição bem-sucedida!")
            else:
                logger.warning(f"⚠️ Status inesperado: {response.text[:200]}")

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
        """Retorna frase motivacional de fallback inteligente"""

        # Frases mais variadas e contextuais
        morning_phrases = [
            "🌟 Vamos dar o nosso melhor hoje! Cada venda nos aproxima do sucesso! 💪",
            "🚀 Hoje é um novo dia para alcançarmos nossas metas! Foco e determinação! 🎯",
            "✨ Juntos somos mais fortes! Vamos em frente equipe! 💫",
            "🔥 A energia está alta! Vamos transformar esse dia em mais um sucesso! ⭐",
            "💎 Cada cliente é uma oportunidade de brilhar! Vamos conquistar! 🏆"
        ]

        evening_phrases = [
            "🌙 Parabéns pelo esforço de hoje! Cada resultado nos ensina e fortalece! ⭐",
            "🏆 Amanhã é uma nova oportunidade de brilhar ainda mais! 💫",
            "� O importante é nunca desistir dos nossos sonhos! Vamos em frente! 🌟",
            "🎊 Vamos descansar e voltar ainda mais fortes amanhã! 🔥",
            "✨ Hoje foi mais um dia de aprendizado! Amanhã será de conquistas! 🚀"
        ]

        fallback_phrases = {
            "morning": morning_phrases,
            "evening": evening_phrases
        }

        phrases = fallback_phrases.get(period, morning_phrases)

        # Escolher uma frase aleatória em vez de sempre a primeira
        import random
        phrase = random.choice(phrases)

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

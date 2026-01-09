"""
Serviço para integração com Agent-Zero para geração de frases motivacionais.
"""

import logging
import requests
from typing import Optional, Dict, Any
import base64
from config import ConfigManager

logger = logging.getLogger(__name__)

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

            # Preparar contexto para o agent
            context = self._prepare_context(message_data, chart_image_url, period)

            # Fazer requisição para o agent-zero
            result = self._make_request(context)

            if result and 'message' in result:
                motivational_phrase = result['message']
                if motivational_phrase:
                    logger.info(f"✅ Frase motivacional gerada: {motivational_phrase[:50]}...")
                    return motivational_phrase
                else:
                    logger.warning("⚠️ Agent-Zero retornou uma frase vazia")
            else:
                logger.error(f"❌ Agent-Zero retornou resposta inválida: {result}")

        except Exception as e:
            logger.error(f"❌ Erro ao gerar frase motivacional: {e}")

        logger.warning("⚠️ Usando frase de fallback")
        return self._get_fallback_phrase(period)

    def _prepare_context(
        self,
        message_data: Dict[str, Any],
        chart_image_url: Optional[str],
        period: str
    ) -> Dict[str, Any]:
        """Prepara contexto para enviar ao Agent-Zero"""

        team = message_data.get('team', 'equipe')
        values = message_data.get('values', {})
        metas_atingidas = message_data.get('metas_atingidas', {})

        # Construir resumo das vendas
        venda_hoje = values.get('venda_hoje', '0')
        vendas_ontem = values.get('vendas_ontem', '0')
        meta_1a = values.get('meta_1a', '0')

        # Criar contexto de vendas
        context_text = f"""Dados da equipe {team} no período da {period}:

Vendas de hoje: R$ {venda_hoje}
Vendas de ontem: R$ {vendas_ontem}
1ª Meta: R$ {meta_1a}

Status das metas:"""

        for meta, atingida in metas_atingidas.items():
            status = "✅ Atingida" if atingida else "⏳ Pendente"
            context_text += f"\n- {meta.replace('_', ' ').title()}: {status}"

        context = {
            "task": "generate_motivational_phrase",
            "period": period,
            "data": {
                "sales_data": message_data,
                "chart_url": chart_image_url,
                "context": {
                    "company": "Skincos",
                    "team": team,
                    "period_type": "manhã" if period == "morning" else "noite",
                    "language": "pt-BR"
                }
            },
            "requirements": {
                "tone": "motivacional e encorajador",
                "length": "1-2 frases",
                "style": "profissional mas caloroso",
                "include_emojis": True,
                "focus": "resultados e motivação para próximas vendas"
            },
            "context_text": context_text
        }

        logger.debug(f"📝 Contexto preparado para Agent-Zero: {context}")
        return context

    def _make_request(self, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Faz requisição para o Agent-Zero usando a API correta"""

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "SKINCOS-AgentZero/1.0"
        }

        # Construir texto motivacional baseado no contexto
        team = context.get('data', {}).get('context', {}).get('team', 'equipe')
        period = context.get('period', 'morning')
        period_name = "manhã" if period == "morning" else "noite"

        # Criar prompt para o Agent Zero
        prompt = f"""Gere uma frase motivacional curta (1-2 frases) para a equipe {team} no período da {period_name}.

Contexto: {context.get('data', {}).get('sales_data', {})}

Requisitos:
- Tom motivacional e encorajador
- Estilo profissional mas caloroso
- Incluir emojis
- Foco em resultados e motivação para próximas vendas
- Idioma: português brasileiro"""

        # Payload correto para a API do Agent Zero
        payload = {
            "text": prompt,
            "context": f"motivation_{team}_{period}"
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

            if response.ok:
                result = response.json()
                logger.debug(f"📋 Resposta Agent-Zero: {result}")
                return result
            else:
                logger.error(f"❌ Agent-Zero HTTP {response.status_code}: {response.text}")
                return None

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

            test_payload = {
                "test": True,
                "message": "health check"
            }

            response = requests.post(
                f"{self.api_url}/health",
                json=test_payload,
                headers={"Content-Type": "application/json"},
                timeout=10
            )

            if response.ok:
                logger.info("✅ Agent-Zero está respondendo")
                return True
            else:
                logger.warning(f"⚠️ Agent-Zero retornou {response.status_code}")
                return False

        except Exception as e:
            logger.error(f"❌ Erro ao testar Agent-Zero: {e}")
            return False

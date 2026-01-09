"""
Gerador de mensagens motivacionais e informativas.
"""

import random
import logging
from typing import Dict, Optional
from config import ConfigConstants
from ..utils.formatting import safe_float_convert
from .goals import GoalTracker
from a0.agentzero.service import AgentZeroService

logger = logging.getLogger(__name__)

class MessageGenerator:
    """Gerador de mensagens motivacionais e informativas"""

    def __init__(self):
        self.goal_tracker = GoalTracker()
        self.agent_zero = AgentZeroService()

    def generate(self, values: Dict[str, str], cell_set: str, period: str,
                metas_atingidas: Dict[str, bool], chart_image_url: Optional[str] = None) -> str:
        """Gera mensagem completa baseada nos dados"""
        try:
            # Preparar dados para o Agent-Zero gerar frase motivacional
            message_data = {
                'team': cell_set.upper(),
                'period': period,
                'values': values,
                'metas_atingidas': metas_atingidas,
                'melhor_meta_ontem': self.goal_tracker.get_yesterday_best_goal(cell_set)
            }

            # Gerar frase motivacional com Agent-Zero
            logger.info("🤖 Gerando frase motivacional com Agent-Zero...")
            frase_motivacional = self.agent_zero.generate_motivational_phrase(
                message_data,
                chart_image_url,
                period
            )

            # Configurar logger para mostrar detalhes de debug em caso de erro
            logger.debug(f"Gerando mensagem para {cell_set} no período {period}")

            # Inicializar variável de mensagem
            message = ""

            # Obter template da configuração
            global_config = ConfigConstants().GLOBAL_CONFIG
            unit_name = cell_set.upper()

            if period == "evening":
                # Usar template de mensagem noturna
                evening_template = global_config.get('evening_message', '')

                if evening_template:
                    # Calcular valores faltantes para as metas
                    venda_hoje_float = safe_float_convert(values.get('venda_hoje', '0'))
                    meta_1a_float = safe_float_convert(values.get('meta_1a', '0'))
                    meta_2a_float = safe_float_convert(values.get('meta_2a', '0'))
                    meta_3a_float = safe_float_convert(values.get('meta_3a', '0'))
                    meta_super_float = safe_float_convert(values.get('meta_super', '0'))

                    # Calcular diferenças
                    falta_1a = max(0, meta_1a_float - venda_hoje_float)
                    falta_2a = max(0, meta_2a_float - venda_hoje_float)
                    falta_3a = max(0, meta_3a_float - venda_hoje_float)
                    falta_super = max(0, meta_super_float - venda_hoje_float)

                    # Função para formatar valores em "R$ Xk"
                    def format_k(value):
                        value = round(value)
                        if value >= 1000:
                            return f"R$ {int(value/1000)}k"
                        return f"R$ {int(value)}"

                    # Preparar valores para status de metas
                    status_1a_text = '' if metas_atingidas.get('1a', False) else f" - _faltou {format_k(falta_1a)}_"
                    status_2a_text = '' if metas_atingidas.get('2a', False) else f" - _faltou {format_k(falta_2a)}_"
                    status_3a_text = '' if metas_atingidas.get('3a', False) else f" - _faltou {format_k(falta_3a)}_"
                    status_super_text = '' if metas_atingidas.get('super', False) else f" - _faltou {format_k(falta_super)}_"

                    # Preparar dados para o template noturno com múltiplas variantes dos nomes
                    template_data = {
                        'unit_name': unit_name,
                        **values,
                        'frase_motivacional': frase_motivacional,
                        # Status icons
                        'status_1a': '✅' if metas_atingidas.get('1a', False) else '❌',
                        'status_2a': '✅' if metas_atingidas.get('2a', False) else '❌',
                        'status_3a': '✅' if metas_atingidas.get('3a', False) else '❌',
                        'status_super': '✅' if metas_atingidas.get('super', False) else '❌',

                        # Status text variations to ensure compatibility
                        'status_1a_text': status_1a_text,
                        'status1a_text': status_1a_text,
                        'status1a text': status_1a_text,
                        'status 1a text': status_1a_text,

                        'status_2a_text': status_2a_text,
                        'status2a_text': status_2a_text,
                        'status2a text': status_2a_text,
                        'status 2a text': status_2a_text,

                        'status_3a_text': status_3a_text,
                        'status3a_text': status_3a_text,
                        'status3a text': status_3a_text,
                        'status 3a text': status_3a_text,

                        'status_super_text': status_super_text,
                        'statussuper_text': status_super_text,
                        'statussuper text': status_super_text,
                        'status super text': status_super_text
                    }

                    try:
                        # Aplicar template noturno com tratamento robusto de variáveis
                        message = evening_template.format(**template_data)
                        logger.debug("✅ Template de mensagem noturna aplicado com sucesso")
                    except KeyError as e:
                        logger.error(f"❌ Variável {e} não encontrada no template noturno")
                        # Tente corrigir o nome da variável automaticamente
                        var_name = str(e).strip("'")
                        possible_corrections = [
                            var_name.replace(" ", "_"),
                            var_name.replace("_", ""),
                            var_name.lower(),
                            var_name.upper(),
                            var_name.replace("1a", "1_a"),
                            var_name.replace("2a", "2_a"),
                            var_name.replace("3a", "3_a")
                        ]

                        # Tente aplicar cada correção
                        fixed = False
                        for correction in possible_corrections:
                            if correction in template_data:
                                template_data[var_name] = template_data[correction]
                                logger.info(f"🔄 Corrigido: variável '{var_name}' substituída por '{correction}'")
                                fixed = True
                                break

                        if fixed:
                            # Tente novamente com a correção
                            try:
                                message = evening_template.format(**template_data)
                                logger.info("✅ Template de mensagem noturna aplicado com correção")
                            except KeyError as e2:
                                logger.error(f"❌ Ainda faltando variável {e2} no template após correção")
                                message = f"Erro ao aplicar template noturno: variável {e2} não encontrada"
                        else:
                            message = f"Erro ao aplicar template noturno: variável {e} não encontrada"
                else:
                    logger.error("❌ Template de mensagem noturna não encontrado no config.json")
            else:
                # Usar template de mensagem matinal (morning)
                morning_template = global_config.get('morning_message', '')

                if morning_template:
                    # Preparar dados para o template matinal
                    meta_1a_float = safe_float_convert(values.get('meta_1a', '0'))
                    meta_2a_float = safe_float_convert(values.get('meta_2a', '0'))
                    meta_3a_float = safe_float_convert(values.get('meta_3a', '0'))
                    meta_super_float = safe_float_convert(values.get('meta_super', '0'))

                    # Exibir ✅ se meta == 0, senão mostrar valor exato (sem arredondar)
                    meta_1a_display = '✅' if meta_1a_float == 0 else f"R$ {meta_1a_float:,.0f}".replace(",", ".")
                    meta_2a_display = '✅' if meta_2a_float == 0 else f"R$ {meta_2a_float:,.0f}".replace(",", ".")
                    meta_3a_display = '✅' if meta_3a_float == 0 else f"R$ {meta_3a_float:,.0f}".replace(",", ".")
                    meta_super_display = '✅' if meta_super_float == 0 else f"R$ {meta_super_float:,.0f}".replace(",", ".")

                    # Acumulado da semana: mesma dinâmica
                    acumulado_semana = safe_float_convert(values.get('acumulado_semana', '0'))
                    meta_semana_1a = safe_float_convert(values.get('meta_semana_1a', '0'))
                    meta_semana_2a = safe_float_convert(values.get('meta_semana_2a', '0'))
                    meta_semana_3a = safe_float_convert(values.get('meta_semana_3a', '0'))
                    meta_semana_super = safe_float_convert(values.get('meta_semana_super', '0'))

                    def status_semana(meta, acumulado):
                        if meta == 0:
                            return '✅'
                        elif acumulado >= meta:
                            return '✅'
                        else:
                            return f"R$ {meta:,.0f}".replace(",", ".")

                    template_data = {
                        'unit_name': unit_name,
                        **values,
                        'meta_1a': meta_1a_display,
                        'meta_2a': meta_2a_display,
                        'meta_3a': meta_3a_display,
                        'meta_super': meta_super_display,
                        'frase_motivacional': frase_motivacional,
                        'status_semana_1a': status_semana(meta_semana_1a, acumulado_semana),
                        'status_semana_2a': status_semana(meta_semana_2a, acumulado_semana),
                        'status_semana_3a': status_semana(meta_semana_3a, acumulado_semana),
                        'status_semana_super': status_semana(meta_semana_super, acumulado_semana),
                        # Status para compatibilidade, mas não usados na manhã:
                        'status_1a': '✅' if metas_atingidas.get('1a', False) else '',
                        'status_2a': '✅' if metas_atingidas.get('2a', False) else '',
                        'status_3a': '✅' if metas_atingidas.get('3a', False) else '',
                        'status_super': '✅' if metas_atingidas.get('super', False) else '',
                    }

                    # Aplicar template matinal
                    message = morning_template.format(**template_data)
                else:
                    logger.error("❌ Template de mensagem matinal não encontrado no config.json")

            # Normalizar quebras de linha
            message = message.rstrip()

            logger.info(f"💬 Mensagem gerada ({period})")
            return message

        except KeyError as e:
            var_name = str(e).strip("'")
            logger.error(f"❌ Erro no template: variável '{var_name}' não encontrada")

            # Mostrar todas as variáveis disponíveis para facilitar o debug
            available_vars = []
            try:
                if 'template_data' in locals():
                    available_vars = list(template_data.keys())
                    logger.debug(f"Variáveis disponíveis: {available_vars}")

                    # Tentar encontrar variáveis similares para sugerir correções
                    suggestions = [v for v in available_vars if var_name.lower() in v.lower()]
                    if suggestions:
                        logger.info(f"Sugestões de substituição para '{var_name}': {suggestions}")
                else:
                    logger.debug("Nenhuma variável de template disponível para debug")
            except Exception as debug_err:
                logger.debug(f"Erro ao processar debug de variáveis: {debug_err}")

            return f"Erro ao gerar mensagem: variável '{var_name}' não encontrada nos dados"
        except Exception as e:
            logger.error(f"❌ Erro ao gerar mensagem: {str(e)}")
            import traceback
            logger.debug(f"Detalhes do erro:\n{traceback.format_exc()}")
            return f"Erro ao gerar mensagem para {cell_set.upper()}: {str(e)}"

    def _select_motivational_phrase(self, categoria_meta: str, period: str = "morning") -> str:
        """Seleciona uma frase motivacional aleatória baseada na categoria da meta e período"""
        try:
            # Carregar frases motivacionais
            frases = ConfigConstants().MOTIVATIONAL_PHRASES

            # Selecionar período
            if period not in frases:
                logger.warning(f"⚠️ Período '{period}' não encontrado, usando 'morning'")
                period = 'morning'

            frases_periodo = frases[period]

            # Selecionar categoria
            if categoria_meta not in frases_periodo:
                logger.warning(f"⚠️ Categoria '{categoria_meta}' não encontrada")
                categoria_meta = 'nenhuma_meta'

            lista_frases = frases_periodo[categoria_meta]
            frase_selecionada = random.choice(lista_frases)

            logger.info(f"💬 {categoria_meta}")
            return frase_selecionada

        except Exception as e:
            logger.error(f"❌ Erro selecionar frase: {e}")
            return "Que hoje seja um dia incrível! 🌟"

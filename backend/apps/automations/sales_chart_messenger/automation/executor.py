"""
Executor principal da automação que orquestra todos os componentes.
"""

import os
import logging
import requests
from typing import Optional
from datetime import date
from ..gapis import GoogleSheetsService
from libs.whatsapp import MessageSender
from ..validation import ChartValidator
from .goals import GoalTracker
from .messages import MessageGenerator
from .downloads import ChartDownloader

logger = logging.getLogger(__name__)

class AutomationExecutor:
    """Executor principal da automação"""

    def __init__(self):
        self.sheets_service = GoogleSheetsService()
        self.message_sender = MessageSender()
        self.validator = ChartValidator()
        self.goal_tracker = GoalTracker()
        self.message_generator = MessageGenerator()
        self.chart_downloader = ChartDownloader()

    def execute(
        self,
        cell_set: str,
        chart_id: Optional[str] = None,
        test_mode: bool = False,
        period: str = "morning",
        force: bool = False,
    ):
        """Executa a automação completa"""
        try:
            logger.info("🚀 Automação iniciada")

            # 1. Obter dados do Google Sheets
            values = self.sheets_service.get_cell_values_for_set(cell_set)
            logger.info(f"📋 Dados: {values}")

            # 2. Analisar metas atingidas
            metas_atingidas = self.goal_tracker.analyze_goals(values)
            self.goal_tracker.register_goals(cell_set, metas_atingidas)

            # 3. Determinar chart ID se não fornecido explicitamente
            if not chart_id:
                chart_id = self._get_chart_id_for_execution(cell_set, period)

            # 4. Obter URL público do gráfico para usar como mídia e contexto para Agent-Zero
            media_url = None
            if chart_id:
                logger.info(f"📊 Processando gráfico: {chart_id}")
                media_url = self.chart_downloader.get_chart_public_url(chart_id)
                if media_url:
                    logger.info(f"✅ URL do gráfico para WhatsApp: {media_url}")
                else:
                    logger.error("❌ Falha ao obter URL público do gráfico")
            else:
                logger.warning("⚠️ Nenhum gráfico será anexado")

            # 5. Gerar mensagem (agora com URL da imagem para Agent-Zero)
            message = self.message_generator.generate(
                values, cell_set, period, metas_atingidas, media_url
            )

            # Não há mais necessidade de baixar/excluir arquivo local

            # 6. Enviar mensagem
            if test_mode:
                result = self.message_sender.send_test_message(message, media_url)
                logger.info("✅ TESTE OK!")
            else:
                idem = f"sales-chart-messenger:prod:{cell_set}:{period}:{date.today().isoformat()}"
                result = self.message_sender.send_production_message(
                    message,
                    media_url,
                    idempotency_key=idem,
                    force=force,
                    audit_context={
                        "module": "sales-chart-messenger",
                        "cell_set": cell_set,
                        "period": period,
                        "chart_id": chart_id,
                    },
                )
                logger.info("✅ PRODUÇÃO OK!")

            # 7. Não há mais arquivo local para excluir
            return result

        except BrokenPipeError as e:
            logger.error(f"❌ Erro de conexão (Broken pipe): {e}")
            logger.error("💡 Tentando reconectar e continuar...")

            # Wait a bit before retrying
            import time
            time.sleep(3)

            # Try again with reduced functionality (without chart)
            try:
                # Sempre regenera a mensagem para garantir que está definida
                logger.info("🔄 Regenerando dados e mensagem após erro de conexão...")
                values = self.sheets_service.get_cell_values_for_set(cell_set)
                metas_atingidas = self.goal_tracker.analyze_goals(values)
                message = self.message_generator.generate(
                    values, cell_set, period, metas_atingidas
                )

                if test_mode:
                    result = self.message_sender.send_test_message(message, None)
                    logger.info("✅ TESTE OK (sem gráfico)!")
                else:
                    idem = f"sales-chart-messenger:prod:{cell_set}:{period}:{date.today().isoformat()}"
                    result = self.message_sender.send_production_message(
                        message,
                        None,
                        idempotency_key=idem,
                        force=force,
                        audit_context={
                            "module": "sales-chart-messenger",
                            "cell_set": cell_set,
                            "period": period,
                            "chart_id": chart_id,
                        },
                    )
                    logger.info("✅ PRODUÇÃO OK (sem gráfico)!")
                return result
            except Exception as retry_error:
                logger.error(f"❌ Retry falhou: {retry_error}")
                raise

        except requests.exceptions.HTTPError as e:
            # Tratar erros HTTP específicos (502, 503, 504)
            status_code = getattr(e.response, 'status_code', None) if hasattr(e, 'response') else None

            if status_code in [502, 503, 504]:
                logger.error(f"❌ Gateway Error {status_code}: {e}")
                logger.info("💡 Servidor WhatsApp temporariamente indisponível")

                # Tentar continuar sem mídia
                try:
                    logger.info("🔄 Tentando enviar apenas texto sem mídia...")
                    # Sempre regenera a mensagem para garantir que está disponível
                    if 'values' not in locals():
                        values = self.sheets_service.get_cell_values_for_set(cell_set)
                        metas_atingidas = self.goal_tracker.analyze_goals(values)
                        message = self.message_generator.generate(
                            values, cell_set, period, metas_atingidas
                        )

                    # Enviar sem mídia
                    if test_mode:
                        result = self.message_sender.send_test_message(message, None)
                        logger.info("✅ TESTE OK (sem mídia por gateway error)!")
                    else:
                        idem = f"sales-chart-messenger:prod:{cell_set}:{period}:{date.today().isoformat()}"
                        result = self.message_sender.send_production_message(
                            message,
                            None,
                            idempotency_key=idem,
                            force=force,
                            audit_context={
                                "module": "sales-chart-messenger",
                                "cell_set": cell_set,
                                "period": period,
                                "chart_id": chart_id,
                            },
                        )
                        logger.info("✅ PRODUÇÃO OK (sem mídia por gateway error)!")
                    return result

                except Exception as retry_error:
                    logger.error(f"❌ Retry após gateway error falhou: {retry_error}")
                    # Para GitHub Actions, não falhar completamente em gateway errors
                    logger.warning("🤖 GitHub Actions: Ignorando erro de gateway - servidor pode estar reiniciando")
                    return {"status": "gateway_error_ignored", "success": False}
            else:
                logger.error(f"❌ HTTP Error {status_code}: {e}")
                raise

        except requests.exceptions.ConnectionError as e:
            logger.error(f"❌ Erro de conexão: {e}")
            logger.error(f"❌ Erro não relacionado a gateway: {e}")

            # Para GitHub Actions e testes, não falhar completamente em erros de conexão
            logger.warning("🤖 Sistema: Todos os endpoints WhatsApp indisponíveis - modo degradado")
            logger.info("💡 Possíveis causas: servidor reiniciando, manutenção, rede instável")

            # Retornar indicação de falha graciosamente para CI/CD
            return {
                "status": "connection_error",
                "success": False,
                "message": "WhatsApp API indisponível",
                "error_type": "connection_timeout"
            }

        except OSError as e:
            # Handle broken pipe that might appear as a generic OSError
            if "Broken pipe" in str(e):
                logger.error(f"❌ OSError com erro de conexão (Broken pipe): {e}")
                logger.error("💡 Tentando reconectar e continuar...")

                # Wait a bit before retrying
                import time
                time.sleep(3)

                # Try again with reduced functionality (without chart)
                try:
                    # Sempre regenera a mensagem para garantir que está definida
                    logger.info("🔄 Regenerando dados e mensagem após erro de conexão...")
                    values = self.sheets_service.get_cell_values_for_set(cell_set)
                    metas_atingidas = self.goal_tracker.analyze_goals(values)
                    message = self.message_generator.generate(
                        values, cell_set, period, metas_atingidas
                    )

                    if test_mode:
                        result = self.message_sender.send_test_message(message, None)
                        logger.info("✅ TESTE OK (sem gráfico)!")
                    else:
                        idem = f"sales-chart-messenger:prod:{cell_set}:{period}:{date.today().isoformat()}"
                        result = self.message_sender.send_production_message(
                            message,
                            None,
                            idempotency_key=idem,
                            force=force,
                            audit_context={
                                "module": "sales-chart-messenger",
                                "cell_set": cell_set,
                                "period": period,
                                "chart_id": chart_id,
                            },
                        )
                        logger.info("✅ PRODUÇÃO OK (sem gráfico)!")
                    return result
                except Exception as retry_error:
                    logger.error(f"❌ Retry falhou após OSError: {retry_error}")
                    raise
            else:
                # For other OSErrors, just log and re-raise
                logger.error(f"❌ OSError não relacionado a broken pipe: {e}")
                raise

        except Exception as e:
            logger.error(f"❌ Automação falhou: {e}")
            raise

    def execute_morning(self, cell_set: str, chart_id: Optional[str] = None, test_mode: bool = False):
        """Executa automação matinal"""
        return self.execute(cell_set, chart_id, test_mode, "morning")

    def execute_evening(self, cell_set: str, chart_id: Optional[str] = None, test_mode: bool = False):
        """Executa automação noturna"""
        return self.execute(cell_set, chart_id, test_mode, "evening")

    def _get_chart_id_for_execution(self, cell_set: str, period: str) -> Optional[str]:
        """Obtém o chart ID correto baseado no cell_set e período"""
        try:
            from config import ConfigManager
            config = ConfigManager.get_config()

            # Buscar o chart_id específico para o período
            chart_key = f"chart_id_{period}"  # chart_id_morning ou chart_id_evening

            units = config.get('units', {})
            cell_set_config = units.get(cell_set, {})

            chart_id = cell_set_config.get(chart_key)
            if chart_id:
                logger.info(f"📊 Chart ID selecionado: {chart_id} ({cell_set} {period})")
                return chart_id
            else:
                # Fallback para chart_id genérico
                fallback_id = cell_set_config.get('chart_id')
                if fallback_id:
                    logger.info(f"📊 Chart ID fallback: {fallback_id} ({cell_set})")
                    return fallback_id

            logger.warning(f"⚠️ Nenhum chart ID encontrado para {cell_set} {period}")
            return None

        except Exception as e:
            logger.error(f"❌ Erro ao obter chart ID: {e}")
            return None

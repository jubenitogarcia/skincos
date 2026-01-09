"""
Sistema de rastreamento e análise de metas.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict
from config import ConfigManager
from ..utils import safe_float_convert

logger = logging.getLogger(__name__)

class GoalTracker:
    """Sistema de rastreamento e análise de metas"""

    def analyze_goals(self, values: Dict[str, str]) -> Dict[str, bool]:
        """Analisa os valores das células para determinar quais metas foram atingidas"""
        try:
            # Extrair valores relevantes
            venda_hoje = safe_float_convert(values.get('venda_hoje', '0'))
            meta_1a = safe_float_convert(values.get('meta_1a', '0'))
            meta_2a = safe_float_convert(values.get('meta_2a', '0'))
            meta_3a = safe_float_convert(values.get('meta_3a', '0'))

            # Usar apenas meta_super (sem fallback)
            meta_super = safe_float_convert(values.get('meta_super', '0'))

            # Debug
            logger.debug(f"🔍 Super meta valor: {meta_super}")

            # Determinar metas atingidas
            metas = {
                '1a': venda_hoje >= meta_1a if meta_1a > 0 else True,
                '2a': venda_hoje >= meta_2a if meta_2a > 0 else True,
                '3a': venda_hoje >= meta_3a if meta_3a > 0 else True,
                'super': venda_hoje >= meta_super if meta_super > 0 else True
            }

            logger.info(f"📊 Venda: {venda_hoje}")
            logger.info(f"   1ª: {meta_1a} {'✅' if metas['1a'] else '❌'}")
            logger.info(f"   2ª: {meta_2a} {'✅' if metas['2a'] else '❌'}")
            logger.info(f"   3ª: {meta_3a} {'✅' if metas['3a'] else '❌'}")
            logger.info(f"   Super: {meta_super} {'✅' if metas['super'] else '❌'}")

            return metas

        except Exception as e:
            logger.error(f"❌ Erro analisar metas: {e}")
            return {'1a': False, '2a': False, '3a': False, 'super': False}

    def register_goals(self, cell_set: str, metas_atingidas: Dict[str, bool]) -> None:
        """Registra quais metas foram atingidas no config.json"""
        try:
            # Carregar configurações atuais
            config = ConfigManager.get_config()

            # Garantir que a seção goal_tracking existe
            if 'goal_tracking' not in config:
                config['goal_tracking'] = {}

            if cell_set not in config['goal_tracking']:
                config['goal_tracking'][cell_set] = {}

            # Data de hoje
            data_hoje = datetime.now().strftime('%Y-%m-%d')

            # Atualizar com as metas de hoje
            config['goal_tracking'][cell_set][data_hoje] = {
                'metas_atingidas': metas_atingidas,
                'timestamp': datetime.now().isoformat()
            }

            # Salvar configurações atualizadas
            config_path = ConfigManager.CONFIG_FILE
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=4, ensure_ascii=False)

            # Log das metas atingidas
            metas_texto = []
            for meta, atingida in metas_atingidas.items():
                if atingida:
                    metas_texto.append(meta)

            if metas_texto:
                logger.info(f"📊 Metas {cell_set}: {', '.join(metas_texto)}")
            else:
                logger.info(f"📊 Nenhuma meta {cell_set}")

        except Exception as e:
            logger.error(f"❌ Erro registrar metas: {e}")

    def get_yesterday_best_goal(self, cell_set: str) -> str:
        """Obtém a melhor meta atingida ontem para o cell_set especificado"""
        try:
            # Carregar configurações
            config = ConfigManager.get_config()

            # Verificar se a seção goal_tracking existe
            if 'goal_tracking' not in config or cell_set not in config['goal_tracking']:
                logger.info(f"📊 Sem rastreamento {cell_set}")
                return 'nenhuma_meta'

            # Data de ontem
            ontem = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

            if ontem not in config['goal_tracking'][cell_set]:
                logger.info(f"📊 Ontem não encontrado")
                return 'nenhuma_meta'

            metas_ontem = config['goal_tracking'][cell_set][ontem]['metas_atingidas']

            # Verificar metas em ordem de prioridade (da maior para menor)
            if metas_ontem.get('super', False):
                logger.info(f"📊 {cell_set} - Ontem: SUPER! 🌟")
                return 'meta_super'
            elif metas_ontem.get('3a', False):
                logger.info(f"📊 {cell_set} - Ontem: 3ª! 🥉")
                return 'terceira_meta'
            elif metas_ontem.get('2a', False):
                logger.info(f"📊 {cell_set} - Ontem: 2ª! 🥈")
                return 'segunda_meta'
            elif metas_ontem.get('1a', False):
                logger.info(f"📊 {cell_set} - Ontem: 1ª! 🥇")
                return 'primeira_meta'
            else:
                logger.info(f"📊 {cell_set} - Ontem: nenhuma")
                return 'nenhuma_meta'

        except Exception as e:
            logger.error(f"❌ Erro meta ontem: {e}")
            return 'nenhuma_meta'

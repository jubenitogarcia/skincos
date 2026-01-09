#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Serviço para interação com Google Sheets.
"""

import time
import logging
import os
from typing import Dict, List, Optional, Any, cast
from config import ConfigManager, ConfigConstants
from ..cache import CacheManager
from ..utils.data_sanitizer import sanitize_batch_values, log_sanitization_stats, sanitize_sheet_data
from .auth import GoogleAuthService, get_google_apis

logger = logging.getLogger(__name__)

class GoogleSheetsService:
    """Serviço para interação com Google Sheets"""
    _service = None
    _spreadsheet_id_cache = None

    @classmethod
    def get_service(cls):
        """Retorna serviço autenticado do Google Sheets"""
        if cls._service is None:
            cls._service = cls._authenticate()
        return cls._service

    @classmethod
    def _authenticate(cls):
        """Autentica e retorna o serviço"""
        google_apis = get_google_apis()
        if not google_apis:
            raise ImportError("Google APIs não disponíveis")

        config = ConfigManager.get_config()
        scopes = ConfigConstants().SCOPES

        creds = GoogleAuthService.get_credentials(config, scopes)

        # Construir serviço do Google Sheets
        build = google_apis['build']
        service = build('sheets', 'v4', credentials=creds, cache_discovery=False)
        logger.info("🔗 Google Sheets conectado")

        return service

    @classmethod
    def get_spreadsheet_id(cls) -> str:
        """Obtém o ID da planilha da configuração com cache"""
        if cls._spreadsheet_id_cache is not None:
            return cls._spreadsheet_id_cache

        config = ConfigManager.get_config()
        spreadsheet_id = config.get('spreadsheet_id', '')

        # Verificar se é um placeholder
        placeholder_values = ["YOUR_SPREADSHEET_ID", "PLACEHOLDER_ID", "DEFAULT_SPREADSHEET_ID"]
        if not spreadsheet_id or spreadsheet_id in placeholder_values:
            logger.error("❌ SPREADSHEET_ID não configurado")
            raise ValueError("SPREADSHEET_ID deve ser configurado no config.json")

        logger.info(f"📊 SPREADSHEET_ID carregado")

        # Salvar no cache
        cls._spreadsheet_id_cache = spreadsheet_id
        return spreadsheet_id

    @classmethod
    def get_batch_values(cls, cell_ranges: List[str]) -> Dict[str, str]:
        """Obtém valores de múltiplas células com cache otimizado e retry para evitar broken pipe"""
        cache_key = tuple(sorted(cell_ranges))
        max_retries = 3  # Número de tentativas antes de desistir

        # Verificar cache
        cached_data = CacheManager.get(cache_key)
        if cached_data is not None:
            logger.info(f"🎯 Cache hit: {len(cell_ranges)} células")
            # Aplicar sanitização aos dados do cache também (caso tenham sido salvos antes da implementação)
            sanitized_cached_data = sanitize_batch_values(cached_data)
            return sanitized_cached_data

        # Buscar dados com retry logic para evitar broken pipe
        for attempt in range(max_retries):
            try:
                logger.info(f"📊 Buscando {len(cell_ranges)} células (tentativa {attempt+1}/{max_retries})")

                start_time = time.time()
                service = cls.get_service()
                spreadsheet_id = cls.get_spreadsheet_id()

                # Batch request para múltiplas células
                request = cast(Any, service).spreadsheets().values().batchGet(
                    spreadsheetId=spreadsheet_id,
                    ranges=cell_ranges
                )

                response = request.execute()
                elapsed_time = time.time() - start_time

                logger.info(f"✅ Batch API: {elapsed_time:.2f}s")

                # Processar resposta
                values_dict = {}
                for i, value_range in enumerate(response.get('valueRanges', [])):
                    cell_range = cell_ranges[i]
                    values = value_range.get('values', [['']])

                    # Pegar primeiro valor se existir
                    if values and values[0]:
                        values_dict[cell_range] = str(values[0][0])
                    else:
                        values_dict[cell_range] = ''

                # Aplicar sanitização aos dados antes de cachear
                original_values = values_dict.copy()
                values_dict = sanitize_batch_values(values_dict)

                # Log das estatísticas de sanitização
                log_sanitization_stats(original_values, values_dict)

                # Adicionar ao cache
                CacheManager.set(cache_key, values_dict)

                return values_dict

            except BrokenPipeError as e:
                # Tratamento específico para Broken Pipe
                logger.warning(f"⚠️ Broken pipe detectado na tentativa {attempt+1}: {str(e)}")
                if attempt < max_retries - 1:
                    # Esperar um pouco antes de tentar novamente (backoff exponencial)
                    wait_time = 2 ** attempt
                    logger.info(f"⏳ Aguardando {wait_time}s antes de tentar novamente...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"❌ Erro persistente de broken pipe após {max_retries} tentativas")
                    raise

            except OSError as e:
                # Verificar se é um erro de broken pipe
                if "Broken pipe" in str(e):
                    logger.warning(f"⚠️ OSError com broken pipe na tentativa {attempt+1}: {str(e)}")
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        logger.info(f"⏳ Aguardando {wait_time}s antes de tentar novamente...")
                        time.sleep(wait_time)
                    else:
                        logger.error(f"❌ Erro persistente de OSError/broken pipe após {max_retries} tentativas")
                        raise
                else:
                    # É outro tipo de OSError, não tratar como broken pipe
                    logger.error(f"❌ Erro de OSError: {str(e)}")
                    raise

            except Exception as e:
                logger.error(f"❌ Erro ao buscar células: {str(e)}")
                raise

    @classmethod
    def get_cell_values_for_set(cls, cell_set: str) -> Dict[str, str]:
        """Obtém valores de células para um conjunto específico (nh, bss, etc)"""
        cell_references = ConfigConstants().CELL_REFERENCES

        if cell_set not in cell_references:
            logger.error(f"❌ Conjunto '{cell_set}' não encontrado")
            raise ValueError(f"Cell set '{cell_set}' não configurado")

        cells_config = cell_references[cell_set]
        cell_ranges = list(cells_config.values())

        logger.info(f"📊 {len(cell_ranges)} células: {cell_set}")

        # Usar CELL_REFERENCES, que já busca 'units' após a alteração em ConfigConstants
        values_dict = cls.get_batch_values(cell_ranges)

        # Mapear de volta para nomes das chaves
        result = {}
        for key, cell_range in cells_config.items():
            result[key] = values_dict.get(cell_range, '')

        logger.info(f"✅ Dados {cell_set}: {len(result)} valores")
        return result

    @classmethod
    def get_spreadsheet_metadata(cls, spreadsheet_id: Optional[str] = None):
        """Obtém metadados da planilha"""
        if spreadsheet_id is None:
            spreadsheet_id = cls.get_spreadsheet_id()

        service = cls.get_service()
        metadata = cast(Any, service).spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            includeGridData=False
        ).execute()

        # Aplicar sanitização aos metadados
        sanitized_metadata = sanitize_sheet_data(metadata)

        logger.info(f"📝 Metadados sanitizados para planilha: {spreadsheet_id}")
        return sanitized_metadata

    @classmethod
    def get_cell_values_for_set(cls, cell_set: str) -> Dict[str, str]:
        """Obtém valores das células para um conjunto específico"""
        try:
            # Normalizar cell_set para minúsculas
            cell_set = cell_set.lower()

            # Obter configuração do conjunto específico
            config = ConfigManager.get_config()
            units_config = config.get('units', {})

            # Log para debug
            logger.debug(f"🔍 Procurando configuração para: {cell_set}")
            logger.debug(f"🔍 Unidades disponíveis: {list(units_config.keys())}")

            unit_config = units_config.get(cell_set, {})

            if not unit_config:
                logger.error(f"❌ Configuração não encontrada para: {cell_set}")
                logger.error(f"❌ Unidades disponíveis: {list(units_config.keys())}")
                raise ValueError(f"Configuração não encontrada para: {cell_set}")

            # Obter células específicas da unidade
            specific_cells = unit_config.get('specific_cells', {})

            # Obter células comuns globais
            global_config = config.get('global', {})
            common_cells = global_config.get('common_cells', {})

            # Combinar células específicas e comuns
            all_cells = {**common_cells, **specific_cells}  # common primeiro, specific sobrescreve se houver conflito

            # Log para debug
            logger.debug(f"📋 Células comuns: {list(common_cells.keys())}")
            logger.debug(f"📋 Células específicas: {list(specific_cells.keys())}")
            logger.debug(f"📋 Total de células: {len(all_cells)}")

            # Extrair lista de células para buscar
            cell_ranges = list(all_cells.values())

            # Buscar valores em lote
            batch_values = cls.get_batch_values(cell_ranges)

            # Mapear valores de volta
            mapped_values = {}

            for key, cell in all_cells.items():
                value = batch_values.get(cell, '')

                # Debug para células importantes
                if key in ['data_referencia_4', 'meta_super']:
                    logger.debug(f"🔍 {key}: célula={cell}, valor={value}")

                mapped_values[key] = value

            logger.info(f"✅ {len(mapped_values)} valores obtidos para {cell_set}")
            return mapped_values

        except Exception as e:
            logger.error(f"❌ Erro ao obter valores para o conjunto {cell_set}: {str(e)}")
            raise

    @classmethod
    def debug_config(cls):
        """Debug da configuração carregada"""
        config = cls.get_config()
        logger.debug("🔍 === CONFIGURAÇÃO CARREGADA ===")
        logger.debug(f"🔍 Chaves principais: {list(config.keys())}")

        if 'units' in config:
            units = config['units']
            logger.debug(f"🔍 Unidades disponíveis: {list(units.keys())}")
            for unit_name, unit_config in units.items():
                logger.debug(f"🔍 Unidade '{unit_name}': {list(unit_config.keys())}")
        else:
            logger.debug("🔍 ⚠️ Chave 'units' não encontrada na configuração!")

        logger.debug("🔍 === FIM DA CONFIGURAÇÃO ===")

    def execute(self, cell_set: str, chart_id: Optional[str] = None,
                test_mode: bool = False, period: str = "morning"):
        """Executa a automação completa"""
        try:
            logger.info("🚀 Automação iniciada")

            # Debug da configuração
            from config import ConfigManager
            ConfigManager.debug_config()

            # 1. Obter dados do Google Sheets
            values = self.sheets_service.get_cell_values_for_set(cell_set)
            logger.info(f"📋 Dados: {values}")

            # 2. Validar dados
            # (Implementar validações específicas conforme necessário)

            # 3. Executar lógica de negócios
            # (Implementar lógica específica conforme necessário)

            # 4. Atualizar Google Sheets com resultados
            # (Implementar atualização conforme necessário)

            logger.info("✅ Automação concluída com sucesso")

        except Exception as e:
            logger.error(f"❌ Erro na automação: {str(e)}")
            raise

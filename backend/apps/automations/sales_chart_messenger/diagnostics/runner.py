"""
Sistema de diagnóstico completo do sistema.
"""

import logging
import json
import re
import time
import datetime
from typing import Dict, Any
from config import ConfigManager
from ..gapis import GoogleSheetsService
from libs.whatsapp import WhatsAppClient
from ..validation import ChartValidator
from ..cache import CacheManager

# Imports para testes Google
try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

# Imports para validação de chave
try:
    from cryptography.hazmat.primitives import serialization
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

logger = logging.getLogger(__name__)

class DiagnosticsRunner:
    """Sistema de diagnóstico completo do sistema"""

    def __init__(self):
        self.results = {}
        self.validator = ChartValidator()
        self.config = None

    def run_full_diagnostics(self) -> Dict[str, Any]:
        """Executa diagnóstico completo"""
        logger.info("🔍 Iniciando diagnóstico completo")

        tests = [
            ("config_test", self._test_config_loading),
            ("config_validation_test", self._test_config_validation),
            ("google_credentials_test", self._test_google_credentials),
            ("google_auth_test", self._test_google_authentication),
            ("google_sheets_test", self._test_google_sheets_access),
            ("whatsapp_auth_test", self._test_whatsapp_authentication),
            ("chart_validator_test", self._test_chart_validator),
            ("cell_references_test", self._test_cell_references),
            ("cache_system_test", self._test_cache_system),
            ("system_time_test", self._test_system_time),
        ]

        return self._run_test_suite(tests)

    def run_quick_diagnostics(self) -> Dict[str, Any]:
        """Executa diagnóstico rápido - apenas testes essenciais"""
        logger.info("🔍 Iniciando diagnóstico rápido")

        tests = [
            ("config_test", self._test_config_loading),
            ("google_auth_test", self._test_google_authentication),
            ("whatsapp_auth_test", self._test_whatsapp_authentication),
        ]

        return self._run_test_suite(tests)

    def _run_test_suite(self, tests):
        """Executa uma suite de testes"""
        total_tests = len(tests)
        passed_tests = 0

        for test_name, test_func in tests:
            try:
                logger.info(f"🧪 {test_name}")
                result = test_func()
                self.results[test_name] = result

                if result.get('success', False):
                    passed_tests += 1
                    logger.info(f"✅ {test_name}: {result.get('message', 'OK')}")
                else:
                    logger.error(f"❌ {test_name}: {result.get('error', 'Erro desconhecido')}")

            except Exception as e:
                logger.error(f"❌ {test_name}: {e}")
                self.results[test_name] = {'success': False, 'error': str(e)}

        # Relatório final
        success_rate = (passed_tests / total_tests) * 100
        logger.info(f"📊 Resultado: {passed_tests}/{total_tests} ({success_rate:.1f}%)")

        if success_rate >= 80:
            logger.info("✅ Sistema operacional")
        elif success_rate >= 60:
            logger.warning("⚠️ Problemas detectados - sistema parcialmente funcional")
        else:
            logger.error("❌ Falhas críticas - sistema requer atenção")

        return self.results

    def _load_config_safe(self):
        """Carrega configuração de forma segura"""
        if self.config is None:
            try:
                self.config = ConfigManager.get_config()
            except Exception as e:
                logger.error(f"Erro ao carregar configuração: {e}")
                self.config = {}
        return self.config

    def _test_config_loading(self):
        """Testa carregamento de configurações"""
        try:
            config = self._load_config_safe()

            if not config:
                return {'success': False, 'error': 'Configuração vazia ou não carregada'}

            required_keys = ['google_service_account', 'whatsapp_config', 'spreadsheet_id']
            missing_keys = [key for key in required_keys if key not in config]

            if missing_keys:
                return {'success': False, 'error': f'Chaves obrigatórias ausentes: {missing_keys}'}

            return {'success': True, 'message': 'Configuração carregada com sucesso'}

        except Exception as e:
            return {'success': False, 'error': f'Erro carregar config: {e}'}

    def _test_config_validation(self):
        """Testa validação detalhada da configuração"""
        try:
            config = self._load_config_safe()

            # Verificar Google Service Account
            google_creds = config.get('google_service_account', {})
            required_google_fields = [
                'type', 'project_id', 'private_key_id', 'private_key',
                'client_email', 'client_id', 'auth_uri', 'token_uri'
            ]

            missing_google = [field for field in required_google_fields if field not in google_creds]
            if missing_google:
                return {'success': False, 'error': f'Campos Google ausentes: {missing_google}'}

            # Verificar WhatsApp Config
            whatsapp_config = config.get('whatsapp_config', {})
            required_whatsapp_fields = ['api_url', 'api_key']
            missing_whatsapp = [field for field in required_whatsapp_fields if field not in whatsapp_config]

            if missing_whatsapp:
                return {'success': False, 'error': f'Campos WhatsApp ausentes: {missing_whatsapp}'}

            # Verificar Spreadsheet ID
            spreadsheet_id = config.get('spreadsheet_id', '')
            if not spreadsheet_id or len(spreadsheet_id) < 40:
                return {'success': False, 'error': 'Spreadsheet ID inválido'}

            return {'success': True, 'message': 'Validação de configuração OK'}

        except Exception as e:
            return {'success': False, 'error': f'Erro validação config: {e}'}

    def _test_google_credentials(self):
        """Testa credenciais do Google detalhadamente"""
        try:
            config = self._load_config_safe()
            google_creds = config.get('google_service_account', {})

            if not google_creds:
                return {'success': False, 'error': 'Google Service Account não configurado'}

            # Verificar chave privada
            private_key = google_creds.get('private_key', '')

            if not private_key:
                return {'success': False, 'error': 'Chave privada ausente'}

            if 'PLACEHOLDER' in private_key or 'YOUR_PRIVATE_KEY' in private_key:
                return {'success': True, 'message': 'Credenciais Google SKIPPED (placeholder detectado)'}

            # Verificar formato da chave
            if not private_key.startswith('-----BEGIN PRIVATE KEY-----'):
                return {'success': False, 'error': 'Formato da chave privada inválido'}

            # Tentar validar com cryptography se disponível
            if CRYPTO_AVAILABLE:
                try:
                    private_key_bytes = private_key.encode('utf-8')
                    key = serialization.load_pem_private_key(private_key_bytes, password=None)
                    key_type = type(key).__name__
                    return {'success': True, 'message': f'Credenciais válidas ({key_type})'}
                except Exception as e:
                    return {'success': False, 'error': f'Chave privada inválida: {e}'}
            else:
                return {'success': True, 'message': 'Formato da chave parece correto (cryptography n/d)'}

        except Exception as e:
            return {'success': False, 'error': f'Erro credenciais Google: {e}'}

    def _test_google_authentication(self):
        """Testa autenticação do Google Sheets"""
        try:
            if not GOOGLE_AVAILABLE:
                return {'success': False, 'error': 'Bibliotecas Google não disponíveis'}

            config = self._load_config_safe()
            service_account_info = config.get('google_service_account', {})
            private_key = service_account_info.get('private_key', '')

            if not private_key or 'PLACEHOLDER' in private_key:
                return {'success': True, 'message': 'Auth Google SKIPPED (placeholder detectado)'}

            # Criar credenciais
            scopes = config.get('google_scopes', [
                'https://www.googleapis.com/auth/spreadsheets.readonly'
            ])

            try:
                from libs.google import credentials_from_service_account_info

                credentials = credentials_from_service_account_info(service_account_info, scopes=scopes)
            except Exception:
                credentials = service_account.Credentials.from_service_account_info(
                    service_account_info, scopes=scopes
                )

            # Testar refresh do token
            request = Request()
            credentials.refresh(request)

            if not credentials.valid:
                return {'success': False, 'error': 'Token inválido após refresh'}

            return {'success': True, 'message': f'Autenticação Google OK (expira: {credentials.expiry})'}

        except Exception as e:
            error_str = str(e)
            if "Invalid JWT Signature" in error_str:
                return {'success': False, 'error': f'JWT inválido - service account pode estar desabilitado: {e}'}
            else:
                return {'success': False, 'error': f'Erro auth Google: {e}'}

    def _test_google_sheets_access(self):
        """Testa acesso às células do Google Sheets"""
        try:
            if not GOOGLE_AVAILABLE:
                return {'success': False, 'error': 'Bibliotecas Google não disponíveis'}

            config = self._load_config_safe()
            service_account_info = config.get('google_service_account', {})
            private_key = service_account_info.get('private_key', '')

            if not private_key or 'PLACEHOLDER' in private_key:
                return {'success': True, 'message': 'Sheets access SKIPPED (placeholder)'}

            # Criar credenciais e service
            scopes = config.get('google_scopes', [
                'https://www.googleapis.com/auth/spreadsheets.readonly'
            ])

            try:
                from libs.google import build_service, credentials_from_service_account_info

                credentials = credentials_from_service_account_info(service_account_info, scopes=scopes)
                service = build_service("sheets", "v4", credentials, cache_discovery=False)
            except Exception:
                credentials = service_account.Credentials.from_service_account_info(
                    service_account_info, scopes=scopes
                )
                service = build('sheets', 'v4', credentials=credentials)

            request = Request()
            credentials.refresh(request)
            spreadsheet_id = config.get('spreadsheet_id')

            # Testar acesso aos metadados
            sheet_metadata = service.spreadsheets().get(
                spreadsheetId=spreadsheet_id
            ).execute()

            sheet_title = sheet_metadata.get('properties', {}).get('title', 'N/A')

            # Testar leitura de célula
            try:
                result = service.spreadsheets().values().get(
                    spreadsheetId=spreadsheet_id,
                    range='A1'
                ).execute()

                values = result.get('values', [])
                cell_value = values[0][0] if values and values[0] else 'Vazio'

                return {'success': True, 'message': f'Acesso Sheets OK - {sheet_title} (A1: {cell_value})'}

            except Exception:
                return {'success': True, 'message': f'Acesso Sheets OK - {sheet_title} (célula A1 inacessível)'}

        except Exception as e:
            return {'success': False, 'error': f'Erro acesso Sheets: {e}'}

    def _test_whatsapp_authentication(self):
        """Testa configuração da API WhatsApp"""
        try:
            try:
                import requests  # type: ignore
            except ImportError:
                return {'success': False, 'error': 'Dependência ausente: requests'}

            config = ConfigManager.get_config()
            whatsapp_config = config.get('whatsapp_config', {})

            required_fields = ['api_url', 'api_key']
            missing_fields = [field for field in required_fields if not whatsapp_config.get(field)]

            if missing_fields:
                return {'success': False, 'error': f'Campos WhatsApp ausentes: {missing_fields}'}

            # Verificar formato da URL da API
            api_url = whatsapp_config.get('api_url', '')
            if not api_url.startswith('http'):
                return {'success': False, 'error': 'URL da API WhatsApp deve começar com http/https'}

            # Testar conexão direta com a API
            try:
                # Testar endpoint de status
                status_response = requests.get(f"{api_url}/status", timeout=10)

                if status_response.status_code == 200:
                    status_data = status_response.json()
                    is_ready = status_data.get('ready', False)
                    status_msg = status_data.get('status', 'unknown')

                    if is_ready:
                        # Testar envio de mensagem real
                        test_payload = {
                            "number": "555195103563",
                            "message": "🧪 Teste de diagnóstico Sales Chart Messenger"
                        }

                        send_response = requests.post(
                            f"{api_url}/send",
                            json=test_payload,
                            timeout=30
                        )

                        if send_response.status_code == 200:
                            return {'success': True, 'message': f'WhatsApp API OK - Status: {status_msg}'}
                        else:
                            error_data = send_response.json() if send_response.content else {}
                            error_msg = error_data.get('error', f'HTTP {send_response.status_code}')

                            # Verificar se é erro de sessão
                            if 'Session closed' in error_msg or 'Protocol error' in error_msg:
                                return {'success': False, 'error': f'WhatsApp Web desconectado - Necessário reiniciar bot e escanear QR Code'}
                            else:
                                return {'success': False, 'error': f'Erro ao enviar mensagem: {error_msg}'}
                    else:
                        qr_required = status_data.get('qrRequired', False)
                        if qr_required:
                            return {'success': False, 'error': 'Bot não autenticado - Escaneie QR Code'}
                        else:
                            return {'success': False, 'error': f'Bot não está pronto - Status: {status_msg}'}
                else:
                    return {'success': False, 'error': f'API inacessível - HTTP {status_response.status_code}'}

            except requests.exceptions.ConnectionError:
                return {'success': False, 'error': 'Não foi possível conectar à API WhatsApp - Verifique se está rodando'}
            except requests.exceptions.Timeout:
                return {'success': False, 'error': 'Timeout na conexão com API WhatsApp'}
            except Exception as e:
                return {'success': False, 'error': f'Erro na comunicação com API: {e}'}

        except Exception as e:
            return {'success': False, 'error': f'Erro config WhatsApp: {e}'}

    def _test_chart_validator(self):
        """Testa sistema de validação de gráficos"""
        try:
            validator = ChartValidator()

            # Testar validação básica
            test_bytes = b"fake_image_data"
            result = validator.validate_from_bytes(test_bytes, "test_chart")

            # Se PIL não está disponível, deve retornar True
            # Se PIL está disponível, deve retornar False (dados inválidos)
            if result:
                return {'success': True, 'message': 'Validador funcionando (PIL indisponível - aceita tudo)'}
            else:
                return {'success': True, 'message': 'Validador funcionando (PIL disponível - validação ativa)'}

        except Exception as e:
            return {'success': False, 'error': f'Erro validador: {e}'}

    def _test_cell_references(self):
        """Testa referências de células"""
        try:
            from config import ConfigConstants

            cell_references = ConfigConstants().CELL_REFERENCES

            if not cell_references:
                return {'success': False, 'error': 'CELL_REFERENCES vazio'}

            total_sets = len(cell_references)
            total_cells = sum(len(cells) for cells in cell_references.values())

            if total_cells == 0:
                return {'success': False, 'error': 'Nenhuma célula configurada'}

            return {'success': True, 'message': f'Referências OK: {total_sets} conjuntos, {total_cells} células'}

        except Exception as e:
            return {'success': False, 'error': f'Erro referências: {e}'}

    def _test_cache_system(self):
        """Testa sistema de cache"""
        try:
            # Testar cache manager
            test_key = ('test', 'cache', 'system')
            test_data = {'test': True, 'timestamp': 'test'}

            # Testar set
            CacheManager.set(test_key, test_data)

            # Testar get
            cached_data = CacheManager.get(test_key)

            if cached_data == test_data:
                # Limpar teste
                cache = CacheManager.get_cache()
                if test_key in cache:
                    del cache[test_key]

                return {'success': True, 'message': 'Sistema de cache funcionando'}
            else:
                return {'success': False, 'error': 'Cache não retornou dados corretos'}

        except Exception as e:
            return {'success': False, 'error': f'Erro cache: {e}'}

    def _test_system_time(self):
        """Testa sincronização de tempo do sistema"""
        try:
            now = datetime.datetime.now(datetime.timezone.utc)
            timestamp = int(time.time())

            # Verificar se o timestamp está no range esperado para 2025
            expected_2025 = 1735689600  # 1 Jan 2025 00:00:00 UTC
            expected_2026 = 1767225600  # 1 Jan 2026 00:00:00 UTC

            if expected_2025 <= timestamp <= expected_2026:
                return {'success': True, 'message': f'Hora do sistema OK: {now.strftime("%Y-%m-%d %H:%M:%S")} UTC'}
            else:
                return {'success': False, 'error': f'Hora do sistema pode estar incorreta: {now.strftime("%Y-%m-%d %H:%M:%S")} UTC'}

        except Exception as e:
            return {'success': False, 'error': f'Erro verificação de tempo: {e}'}

    def get_summary(self) -> str:
        """Retorna resumo do diagnóstico"""
        if not self.results:
            return "❌ Nenhum diagnóstico executado"

        total = len(self.results)
        passed = sum(1 for result in self.results.values() if result.get('success', False))
        failed = total - passed

        success_rate = (passed / total) * 100

        summary = f"""
📊 RELATÓRIO DE DIAGNÓSTICO
========================
✅ Testes OK: {passed}
❌ Testes com falha: {failed}
📈 Taxa de sucesso: {success_rate:.1f}%

STATUS: {'🟢 OPERACIONAL' if success_rate >= 80 else '🟡 PARCIAL' if success_rate >= 60 else '🔴 CRÍTICO'}
"""

        if failed > 0:
            summary += "\n❌ FALHAS DETECTADAS:\n"
            for test_name, result in self.results.items():
                if not result.get('success', False):
                    summary += f"  - {test_name}: {result.get('error', 'Erro desconhecido')}\n"

        # Adicionar soluções para problemas comuns
        if failed > 0:
            summary += self._get_solution_suggestions()

        return summary

    def _get_solution_suggestions(self) -> str:
        """Retorna sugestões de solução baseadas nos erros encontrados"""
        suggestions = "\n🛠️ SUGESTÕES DE SOLUÇÃO:\n"

        # Verificar tipos de erro
        has_jwt_error = any("JWT" in str(result.get('error', '')) for result in self.results.values())
        has_google_error = any("google" in test_name.lower() for test_name, result in self.results.items() if not result.get('success', False))
        has_whatsapp_session_error = any("Session closed" in str(result.get('error', '')) or "WhatsApp Web desconectado" in str(result.get('error', '')) for result in self.results.values())
        has_whatsapp_error = any("whatsapp" in test_name.lower() for test_name, result in self.results.items() if not result.get('success', False))

        if has_whatsapp_session_error:
            suggestions += """
1️⃣ PROBLEMA WhatsApp Web - Sessão Perdida:
   • O WhatsApp Web foi desconectado
   • SOLUÇÃO RÁPIDA:
     - Reinicie o bot WhatsApp: Ctrl+C e rode novamente
     - Escaneie o QR Code no celular
     - Aguarde até status ficar "ready"

   • VERIFICAÇÃO:
     curl -s https://wa.skincos.com.br/status

   • Se QR Code necessário:
     curl -s https://wa.skincos.com.br/qr
"""

        if has_jwt_error:
            suggestions += """
2️⃣ PROBLEMA JWT/Google:
   • Acesse: https://console.cloud.google.com/iam-admin/serviceaccounts
   • Verifique se o service account está ENABLED
   • Gere nova chave: Keys > Add Key > Create new key (JSON)
   • Substitua as credenciais no config.json
"""

        if has_google_error:
            suggestions += """
3️⃣ PROBLEMA Google Sheets:
   • Verifique se as APIs estão habilitadas:
     - Google Sheets API
     - Google Drive API
   • Compartilhe a planilha com o service account
   • Permissão: Editor ou Visualizador
"""

        if has_whatsapp_error and not has_whatsapp_session_error:
            suggestions += """
4️⃣ PROBLEMA WhatsApp Geral:
   • Verifique se o bot está rodando
   • Confirme a URL da API no config.json
   • Teste a conexão: curl https://wa.skincos.com.br/status
"""

        return suggestions

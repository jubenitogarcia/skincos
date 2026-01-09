#!/usr/bin/env python3
"""
📱 WhatsApp Bulk Sender
Script para envio em massa de mensagens via API WhatsApp
"""

import requests
import time
import random
import os
import re
import csv
import pandas as pd
from typing import List, Optional, Dict, Tuple
from urllib.parse import urlparse
import PyPDF2
import openpyxl
from pathlib import Path
from datetime import datetime
import json
import argparse
from pathlib import Path

try:
    import cloudinary
    import cloudinary.uploader
except ImportError:  # cloudinary is optional but listed in requirements
    cloudinary = None

class WhatsAppBulkSender:
    def __init__(self, api_url: str = "http://efnh.skincos.com.br"):
        self.api_url = api_url
        self.session = requests.Session()
        # Tracking de resultados para relatórios
        self.successful_sends = []
        self.failed_sends = []
        self.start_time = None
        self.end_time = None
        self._uploaded_cache: Dict[str, str] = {}

    # ---------------- Cloudinary helpers ----------------
    def cloudinary_enabled(self) -> bool:
        if cloudinary is None:
            return False
        # Accept either CLOUDINARY_URL or discrete vars
        return bool(os.environ.get('CLOUDINARY_URL') or (
            os.environ.get('CLOUDINARY_CLOUD_NAME') and os.environ.get('CLOUDINARY_API_KEY') and os.environ.get('CLOUDINARY_API_SECRET')
        ))

    def ensure_cloudinary_config(self):
        if not self.cloudinary_enabled():
            return False
        if hasattr(cloudinary, 'config'):
            # If CLOUDINARY_URL set, cloudinary automatically configured; else configure from discrete vars
            if os.environ.get('CLOUDINARY_URL'):
                return True
            cloudinary.config(
                cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
                api_key=os.environ.get('CLOUDINARY_API_KEY'),
                api_secret=os.environ.get('CLOUDINARY_API_SECRET'),
                secure=True
            )
            return True
        return False

    def is_local_media_path(self, media_url: str) -> bool:
        if not media_url:
            return False
        if media_url.lower().startswith('http://') or media_url.lower().startswith('https://'):
            return False
        # Remover quebras de linha acidentais
        media_url = media_url.replace('\n', '').replace('\r', '')
        p = Path(media_url.strip().strip("'"))
        return p.exists() and p.is_file()
    def upload_media_if_local(self, media_url: Optional[str], force: bool = False) -> Optional[str]:
        """Se media_url for caminho local (ou force=True e não for HTTP), faz upload para Cloudinary e retorna URL segura.
        force: tenta mesmo que a detecção padrão falhe.
        """
        if not media_url:
            return media_url
        candidate = media_url.replace('\n', '').replace('\r', '').strip().strip('"').strip("'")
        is_http = candidate.lower().startswith('http://') or candidate.lower().startswith('https://')
        if is_http:
            return media_url  # já é URL
        path_obj = Path(candidate)
        detected = path_obj.exists() and path_obj.is_file()
        if not detected and not force:
            return media_url  # não parece local, e não forçamos
        if not detected and force:
            print(f"⚠️  --force-upload: arquivo não encontrado no caminho fornecido: {candidate}")
            return media_url
        abs_path = str(path_obj.resolve())
        if abs_path in self._uploaded_cache:
            return self._uploaded_cache[abs_path]
        if not self.ensure_cloudinary_config():
            raise RuntimeError("Caminho local fornecido mas Cloudinary não está configurado no ambiente. Defina CLOUDINARY_URL ou CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.")
        size_bytes = path_obj.stat().st_size
        size_mb = size_bytes / (1024*1024)
        print(f"☁️  Upload Cloudinary iniciando: {abs_path} ({size_mb:.2f} MB)")
        try:
            res = cloudinary.uploader.upload(abs_path, resource_type='auto', folder='whatsapp_bulk')
            secure_url = res.get('secure_url') or res.get('url')
            if not secure_url:
                raise RuntimeError('Resposta Cloudinary sem secure_url')
            self._uploaded_cache[abs_path] = secure_url
            print(f"☁️  Upload concluído -> {secure_url}")
            return secure_url
        except Exception as e:
            raise RuntimeError(f"Falha upload Cloudinary: {e}")

    def detect_media_type(self, url: str) -> str:
        """Detecta o tipo de mídia pela extensão da URL"""
        if not url:
            return "text"

        # Extrair extensão da URL
        parsed_url = urlparse(url)
        path = parsed_url.path.lower()

        # URLs especiais conhecidas (como geradores de imagem)
        if 'picsum.photos' in url.lower() or 'placeholder.com' in url.lower():
            return "image"

        # Imagens
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
        if any(path.endswith(ext) for ext in image_extensions):
            return "image"

        # Vídeos
        video_extensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv']
        if any(path.endswith(ext) for ext in video_extensions):
            return "video"

        # Documentos
        document_extensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt']
        if any(path.endswith(ext) for ext in document_extensions):
            return "document"

        # Áudios
        audio_extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac']
        if any(path.endswith(ext) for ext in audio_extensions):
            return "audio"

        return "document"  # Default para documentos

    def format_phone_number(self, phone: str) -> str:
        """Formata número de telefone removendo caracteres especiais"""
        # Remove tudo que não é dígito
        clean_phone = re.sub(r'\D', '', phone)

        # Os números já vem no formato 555199999999 (55 + código da área + número)
        # Se já começar com 55, usar como está
        if clean_phone.startswith('55') and len(clean_phone) >= 12:
            return clean_phone
        # Se não começar com 55, adicionar
        elif not clean_phone.startswith('55'):
            return '55' + clean_phone
        else:
            return clean_phone

    def parse_phone_list(self, phone_input: str) -> List[str]:
        """Converte string de números separados por vírgula em lista"""
        phones = [phone.strip() for phone in phone_input.split(',')]
        return [self.format_phone_number(phone) for phone in phones if phone.strip()]

    def extract_phones_from_text(self, text: str) -> List[str]:
        """Extrai números de telefone de um texto usando regex"""
        # Padrões para números brasileiros
        patterns = [
            r'\b(?:55)?[1-9]{2}9?[0-9]{8}\b',  # Formato: 5511999999999 ou 11999999999
            r'\b\(?(?:55)?\s*\(?[1-9]{2}\)?\s*9?\s*[0-9]{4}[-\s]?[0-9]{4}\b',  # Com formatação
            r'\+55\s*[1-9]{2}\s*9?[0-9]{4}[-\s]?[0-9]{4}'  # Com código internacional
        ]

        phones = []
        for pattern in patterns:
            matches = re.findall(pattern, text)
            phones.extend(matches)

        # Limpar e formatar números encontrados
        formatted_phones = []
        for phone in phones:
            clean_phone = re.sub(r'\D', '', phone)
            if len(clean_phone) >= 10:  # Mínimo 10 dígitos
                formatted_phones.append(self.format_phone_number(clean_phone))

        return list(set(formatted_phones))  # Remove duplicatas

    def read_phones_from_csv(self, file_path: str) -> List[str]:
        """Lê números de telefone de arquivo CSV"""
        phones = []
        try:
            # Tentar diferentes encodings
            encodings = ['utf-8', 'latin-1', 'cp1252']

            for encoding in encodings:
                try:
                    df = pd.read_csv(file_path, encoding=encoding)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError("Não foi possível ler o arquivo CSV com nenhum encoding testado")

            # Procurar por colunas que possam conter telefones
            phone_columns = []
            for col in df.columns:
                col_lower = str(col).lower()
                if any(keyword in col_lower for keyword in ['telefone', 'phone', 'celular', 'contato', 'numero']):
                    phone_columns.append(col)

            # Se não encontrou colunas específicas, usar todas as colunas
            if not phone_columns:
                phone_columns = df.columns.tolist()

            # Extrair números de todas as colunas relevantes
            for col in phone_columns:
                for value in df[col].dropna():
                    text_value = str(value)
                    extracted_phones = self.extract_phones_from_text(text_value)
                    phones.extend(extracted_phones)

            print(f"✅ CSV lido com sucesso: {len(phones)} números encontrados")

        except Exception as e:
            print(f"❌ Erro ao ler CSV: {str(e)}")

        return list(set(phones))  # Remove duplicatas

    def read_phones_from_excel(self, file_path: str) -> List[str]:
        """Lê números de telefone de arquivo Excel"""
        phones = []
        try:
            # Ler todas as planilhas
            excel_file = pd.ExcelFile(file_path)

            for sheet_name in excel_file.sheet_names:
                print(f"📊 Lendo planilha: {sheet_name}")
                df = pd.read_excel(file_path, sheet_name=sheet_name)

                # Procurar por colunas que possam conter telefones
                phone_columns = []
                for col in df.columns:
                    col_lower = str(col).lower()
                    if any(keyword in col_lower for keyword in ['telefone', 'phone', 'celular', 'contato', 'numero']):
                        phone_columns.append(col)

                # Se não encontrou colunas específicas, usar todas as colunas
                if not phone_columns:
                    phone_columns = df.columns.tolist()

                # Extrair números de todas as colunas relevantes
                for col in phone_columns:
                    for value in df[col].dropna():
                        text_value = str(value)
                        extracted_phones = self.extract_phones_from_text(text_value)
                        phones.extend(extracted_phones)

            print(f"✅ Excel lido com sucesso: {len(phones)} números encontrados")

        except Exception as e:
            print(f"❌ Erro ao ler Excel: {str(e)}")

        return list(set(phones))  # Remove duplicatas

    def read_phones_from_pdf(self, file_path: str) -> List[str]:
        """Lê números de telefone de arquivo PDF"""
        phones = []
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                text = ""

                # Extrair texto de todas as páginas
                for page_num in range(len(pdf_reader.pages)):
                    page = pdf_reader.pages[page_num]
                    text += page.extract_text() + "\n"

                # Extrair números do texto
                phones = self.extract_phones_from_text(text)
                print(f"✅ PDF lido com sucesso: {len(phones)} números encontrados")

        except Exception as e:
            print(f"❌ Erro ao ler PDF: {str(e)}")

        return phones

    def read_phones_from_txt(self, file_path: str) -> List[str]:
        """Lê números de telefone de arquivo de texto"""
        phones = []
        try:
            # Tentar diferentes encodings
            encodings = ['utf-8', 'latin-1', 'cp1252']

            for encoding in encodings:
                try:
                    with open(file_path, 'r', encoding=encoding) as file:
                        text = file.read()
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError("Não foi possível ler o arquivo de texto com nenhum encoding testado")

            phones = self.extract_phones_from_text(text)
            print(f"✅ Arquivo de texto lido com sucesso: {len(phones)} números encontrados")

        except Exception as e:
            print(f"❌ Erro ao ler arquivo de texto: {str(e)}")

        return phones

    def read_phones_from_file(self, file_path: str) -> List[str]:
        """Lê números de telefone de acordo com a extensão do arquivo"""
        if not os.path.exists(file_path):
            print(f"❌ Arquivo não encontrado: {file_path}")
            return []

        file_extension = Path(file_path).suffix.lower()

        print(f"📂 Lendo arquivo: {file_path}")
        print(f"📄 Tipo detectado: {file_extension}")

        if file_extension == '.csv':
            return self.read_phones_from_csv(file_path)
        elif file_extension in ['.xlsx', '.xls']:
            return self.read_phones_from_excel(file_path)
        elif file_extension == '.pdf':
            return self.read_phones_from_pdf(file_path)
        elif file_extension in ['.txt', '.text']:
            return self.read_phones_from_txt(file_path)
        else:
            print(f"❌ Tipo de arquivo não suportado: {file_extension}")
            print("💡 Tipos suportados: .csv, .xlsx, .xls, .pdf, .txt")
            return []

    def send_message(self, phone: str, message: str, media_url: Optional[str] = None) -> bool:
        """Envia uma mensagem individual"""
        try:
            # Processar quebras de linha na mensagem
            processed_message = message.replace('\\n', '\n')

            payload = {
                "number": phone,
                "message": processed_message
            }

            # Adicionar mídia se fornecida
            if media_url:
                media_type = self.detect_media_type(media_url)
                payload["type"] = media_type
                payload["url"] = media_url

            response = self.session.post(
                f"{self.api_url}/send",
                json=payload,
                timeout=30
            )

            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            if response.status_code == 200:
                print(f"    ✅ {phone}: Enviado com sucesso")
                # Registrar sucesso
                self.successful_sends.append({
                    "phone": phone,
                    "timestamp": timestamp,
                    "status": "success",
                    "response_code": response.status_code
                })
                return True
            else:
                print(f"    ❌ {phone}: Erro {response.status_code}")
                # Registrar falha
                self.failed_sends.append({
                    "phone": phone,
                    "timestamp": timestamp,
                    "status": "failed",
                    "error": f"HTTP {response.status_code}",
                    "response_code": response.status_code
                })
                return False

        except Exception as e:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            print(f"    ❌ {phone}: Erro - {str(e)}")
            # Registrar exceção
            self.failed_sends.append({
                "phone": phone,
                "timestamp": timestamp,
                "status": "failed",
                "error": str(e),
                "response_code": None
            })
            return False

    def create_blocks(self, phones: List[str]) -> List[List[str]]:
        """Divide a lista de telefones em blocos aleatórios de 5-15 números"""
        blocks = []
        remaining_phones = phones.copy()

        while remaining_phones:
            # Se restam menos de 5 números, pegar todos
            if len(remaining_phones) <= 5:
                blocks.append(remaining_phones)
                break

            # Senão, criar bloco de 5-15 números
            max_block_size = min(15, len(remaining_phones))
            block_size = random.randint(5, max_block_size)
            block = remaining_phones[:block_size]
            blocks.append(block)
            remaining_phones = remaining_phones[block_size:]

        return blocks

    def display_summary(self, phones: List[str], message: str, media_url: Optional[str]):
        """Exibe resumo antes do envio"""
        print("=" * 60)
        print("📊 RESUMO DO ENVIO")
        print("=" * 60)
        print(f"📱 Total de números: {len(phones)}")
        print(f"📝 Mensagem: {message[:50]}..." if len(message) > 50 else f"📝 Mensagem: {message}")

        if media_url:
            media_type = self.detect_media_type(media_url)
            type_emoji = {
                "image": "🖼️",
                "video": "🎥",
                "document": "📄",
                "audio": "🎵"
            }
            print(f"{type_emoji.get(media_type, '📎')} Mídia: {media_type.upper()} - {media_url}")
        else:
            print("📄 Apenas texto")

        blocks = self.create_blocks(phones)
        print(f"📦 Será dividido em {len(blocks)} blocos")
        print(f"⏱️ Tempo estimado: {self.estimate_time(len(phones), len(blocks))} minutos")
        print("=" * 60)

    def estimate_time(self, total_phones: int, total_blocks: int) -> int:
        """Estima tempo total de envio"""
        # Tempo médio entre mensagens: 10s
        # Tempo médio entre blocos: 3 min
        message_time = total_phones * 10  # segundos
        block_time = (total_blocks - 1) * 180  # 3 min entre blocos em segundos
        total_seconds = message_time + block_time
        return round(total_seconds / 60)  # converter para minutos

    def send_bulk(self, phones: List[str], message: str, media_url: Optional[str] = None):
        """Executa o envio em massa"""
        # Registrar horário de início
        self.start_time = datetime.now()

        # Limpar resultados anteriores
        self.successful_sends = []
        self.failed_sends = []

        blocks = self.create_blocks(phones)

        print(f"\n🚀 INICIANDO ENVIO EM MASSA")
        print(f"📦 {len(blocks)} blocos serão processados\n")

        success_count = 0
        total_count = len(phones)

        for block_idx, block in enumerate(blocks, 1):
            print(f"📦 BLOCO {block_idx}/{len(blocks)} - {len(block)} números")
            print("-" * 40)

            # Enviar mensagens do bloco
            for phone_idx, phone in enumerate(block, 1):
                print(f"  📤 [{phone_idx}/{len(block)}] Enviando para {phone}...")

                if self.send_message(phone, message, media_url):
                    success_count += 1

                # Aguardar entre mensagens (5-15s)
                if phone_idx < len(block):  # Não aguardar após última mensagem do bloco
                    wait_time = random.randint(5, 15)
                    print(f"    ⏱️ Aguardando {wait_time}s...", end='', flush=True)

                    # Mostrar countdown em tempo real
                    for i in range(wait_time, 0, -1):
                        print(f"\r    ⏱️ Aguardando {i}s...   ", end='', flush=True)
                        time.sleep(1)
                    print(f"\r    ✅ Pausa de {wait_time}s concluída!   ")  # Limpar linha

            print(f"✅ Bloco {block_idx} concluído!\n")

            # Aguardar entre blocos (1-5 min), exceto no último bloco
            if block_idx < len(blocks):
                wait_minutes = random.randint(1, 5)
                print(f"⏸️ PAUSA ENTRE BLOCOS: {wait_minutes} minutos")
                print(f"   📊 Progresso: {success_count}/{total_count} enviadas")

                # Mostrar countdown
                total_seconds = wait_minutes * 60
                print(f"   ⏰ Iniciando pausa de {wait_minutes} minutos...")

                for remaining in range(total_seconds, 0, -1):
                    minutes = remaining // 60
                    seconds = remaining % 60
                    print(f"   ⏰ Restam {minutes:02d}:{seconds:02d}   ", end='\r', flush=True)
                    time.sleep(1)
                print("   ✅ Pausa concluída!                    ")  # Limpar linha

        # Registrar horário de término
        self.end_time = datetime.now()

        # Resumo final
        print("=" * 60)
        print("🎉 ENVIO CONCLUÍDO!")
        print("=" * 60)
        print(f"✅ Mensagens enviadas: {success_count}")
        print(f"❌ Falhas: {total_count - success_count}")
        print(f"📊 Taxa de sucesso: {(success_count/total_count*100):.1f}%")
        print("=" * 60)

        # Gerar relatório
        self.generate_reports(message, media_url)

    def generate_reports(self, message: str, media_url: Optional[str] = None):
        """Gera relatórios de envio em múltiplos formatos"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Criar diretório de relatórios se não existir
        reports_dir = "relatorios"
        if not os.path.exists(reports_dir):
            os.makedirs(reports_dir)

        # Dados do relatório
        total_phones = len(self.successful_sends) + len(self.failed_sends)
        success_rate = (len(self.successful_sends) / total_phones * 100) if total_phones > 0 else 0

        duration = None
        if self.start_time and self.end_time:
            duration = self.end_time - self.start_time
            duration_str = str(duration).split('.')[0]  # Remove microsegundos
        else:
            duration_str = "N/A"

        # Gerar relatório CSV
        csv_path = f"{reports_dir}/relatorio_whatsapp_{timestamp}.csv"
        self.generate_csv_report(csv_path, message, media_url, success_rate, duration_str)

        # Gerar relatório JSON
        json_path = f"{reports_dir}/relatorio_whatsapp_{timestamp}.json"
        self.generate_json_report(json_path, message, media_url, success_rate, duration_str)

        # Gerar relatório de texto
        txt_path = f"{reports_dir}/relatorio_whatsapp_{timestamp}.txt"
        self.generate_text_report(txt_path, message, media_url, success_rate, duration_str)

        print(f"\n📋 RELATÓRIOS GERADOS:")
        print(f"   📄 CSV: {csv_path}")
        print(f"   📄 JSON: {json_path}")
        print(f"   📄 TXT: {txt_path}")

    def generate_csv_report(self, file_path: str, message: str, media_url: Optional[str], success_rate: float, duration: str):
        """Gera relatório em formato CSV"""
        with open(file_path, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)

            # Cabeçalho do relatório
            writer.writerow(['=== RELATÓRIO DE ENVIO WhatsApp ==='])
            writer.writerow([f'Data/Hora: {datetime.now().strftime("%d/%m/%Y %H:%M:%S")}'])
            writer.writerow([f'Mensagem: {message[:100]}...'])
            writer.writerow([f'Mídia: {media_url if media_url else "Apenas texto"}'])
            writer.writerow([f'Taxa de Sucesso: {success_rate:.1f}%'])
            writer.writerow([f'Duração: {duration}'])
            writer.writerow([])

            # Sucessos
            writer.writerow(['=== ENVIOS BEM-SUCEDIDOS ==='])
            writer.writerow(['Telefone', 'Horário', 'Status', 'Código de Resposta'])
            for send in self.successful_sends:
                writer.writerow([send['phone'], send['timestamp'], send['status'], send.get('response_code', '')])

            writer.writerow([])

            # Falhas
            writer.writerow(['=== ENVIOS FALHARAM ==='])
            writer.writerow(['Telefone', 'Horário', 'Status', 'Erro', 'Código de Resposta'])
            for send in self.failed_sends:
                writer.writerow([send['phone'], send['timestamp'], send['status'], send.get('error', ''), send.get('response_code', '')])

    def generate_json_report(self, file_path: str, message: str, media_url: Optional[str], success_rate: float, duration: str):
        """Gera relatório em formato JSON"""
        report_data = {
            "relatorio_info": {
                "timestamp": datetime.now().isoformat(),
                "mensagem": message,
                "midia": media_url,
                "taxa_sucesso": success_rate,
                "duracao": duration,
                "total_numeros": len(self.successful_sends) + len(self.failed_sends),
                "sucessos": len(self.successful_sends),
                "falhas": len(self.failed_sends)
            },
            "envios_sucessos": self.successful_sends,
            "envios_falhas": self.failed_sends
        }

        with open(file_path, 'w', encoding='utf-8') as jsonfile:
            json.dump(report_data, jsonfile, indent=2, ensure_ascii=False)

    def generate_text_report(self, file_path: str, message: str, media_url: Optional[str], success_rate: float, duration: str):
        """Gera relatório em formato de texto"""
        with open(file_path, 'w', encoding='utf-8') as txtfile:
            txtfile.write("=" * 60 + "\n")
            txtfile.write("📱 RELATÓRIO DE ENVIO WhatsApp\n")
            txtfile.write("=" * 60 + "\n\n")

            txtfile.write(f"📅 Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
            txtfile.write(f"📝 Mensagem: {message}\n")
            txtfile.write(f"📎 Mídia: {media_url if media_url else 'Apenas texto'}\n")
            txtfile.write(f"⏱️ Duração: {duration}\n")
            txtfile.write(f"📊 Taxa de Sucesso: {success_rate:.1f}%\n\n")

            # Estatísticas
            total_numbers = len(self.successful_sends) + len(self.failed_sends)
            txtfile.write("📈 ESTATÍSTICAS:\n")
            txtfile.write(f"   📞 Total de números: {total_numbers}\n")
            txtfile.write(f"   ✅ Sucessos: {len(self.successful_sends)}\n")
            txtfile.write(f"   ❌ Falhas: {len(self.failed_sends)}\n\n")

            # Sucessos
            if self.successful_sends:
                txtfile.write("✅ ENVIOS BEM-SUCEDIDOS:\n")
                txtfile.write("-" * 40 + "\n")
                for i, send in enumerate(self.successful_sends, 1):
                    txtfile.write(f"{i:3d}. {send['phone']} - {send['timestamp']}\n")
                txtfile.write("\n")

            # Falhas
            if self.failed_sends:
                txtfile.write("❌ ENVIOS QUE FALHARAM:\n")
                txtfile.write("-" * 40 + "\n")
                for i, send in enumerate(self.failed_sends, 1):
                    error_info = send.get('error', 'Erro desconhecido')
                    txtfile.write(f"{i:3d}. {send['phone']} - {send['timestamp']}\n")
                    txtfile.write(f"     Erro: {error_info}\n")
                txtfile.write("\n")

            txtfile.write("=" * 60 + "\n")
            txtfile.write("Relatório gerado pelo WhatsApp Bulk Sender\n")
            txtfile.write("=" * 60 + "\n")

def interactive_flow(sender: WhatsAppBulkSender, gateway_url: Optional[str], agz_direct: Optional[bool]):
    """Fluxo interativo original extraído para função separada"""
    print("📝 Digite a mensagem que será enviada:")
    print("💡 Dica: Use \\n para quebras de linha (ex: Linha 1\\nLinha 2)")
    message = input("> ").strip()
    if not message:
        print("❌ Mensagem não pode estar vazia!")
        return
    print("\n📎 URL da mídia (imagem/vídeo/documento) ou ENTER para apenas texto:")
    media_url = input("> ").strip()
    if media_url:
        media_type = sender.detect_media_type(media_url)
        type_emoji = {"image": "🖼️", "video": "🎥", "document": "📄", "audio": "🎵"}
        print(f"   {type_emoji.get(media_type, '📎')} Detectado: {media_type.upper()}")
        # Tentar upload se for caminho local
        if sender.is_local_media_path(media_url):
            try:
                uploaded = sender.upload_media_if_local(media_url)
                if uploaded and uploaded != media_url:
                    print(f"   ☁️  Enviado para Cloudinary. URL pública: {uploaded}")
                    media_url = uploaded
            except Exception as e:
                print(f"   ❌ Erro upload Cloudinary: {e}")
                print("   ⚠️ Abortando (não é seguro continuar com caminho local em gateway remoto).")
                return
    print("\n📱 Como você deseja fornecer os números de telefone?")
    print("1️⃣  Digite manualmente (separados por vírgula)")
    print("2️⃣  Carregar de arquivo (PDF, CSV, Excel, TXT)")
    choice = input("Escolha uma opção (1 ou 2): ").strip()
    phones = []
    if choice == "1":
        print("\n📱 Digite os números separados por vírgula:")
        print("   Exemplo: 51999999999, 51888888888, 11777777777")
        phone_input = input("> ").strip()
        if not phone_input:
            print("❌ Lista de números não pode estar vazia!")
            return
        phones = sender.parse_phone_list(phone_input)
    elif choice == "2":
        print("\n📂 Digite o caminho para o arquivo:")
        print("💡 Tipos suportados: .pdf, .csv, .xlsx, .xls, .txt")
        file_path = input("> ").strip().strip('"').strip("'")
        if not file_path:
            print("❌ Caminho do arquivo não pode estar vazio!")
            return
        phones = sender.read_phones_from_file(file_path)
        if not phones:
            print("❌ Nenhum número válido encontrado no arquivo!")
            return
        print(f"\n📋 Números encontrados ({len(phones)} total):")
        preview_count = min(5, len(phones))
        for i, phone in enumerate(phones[:preview_count]):
            print(f"   {i+1}. {phone}")
        if len(phones) > 5:
            print(f"   ... e mais {len(phones) - 5} números")
    else:
        print("❌ Opção inválida! Digite 1 ou 2.")
        return
    if not phones:
        print("❌ Nenhum número válido encontrado!")
        return
    sender.display_summary(phones, message, media_url if media_url else None)
    print("\n⚠️ Deseja prosseguir com o envio? (s/N)")
    confirm = input("> ").strip().lower()
    if confirm != 's':
        print("❌ Envio cancelado pelo usuário.")
        return
    # Aplicar toggle se solicitado (interativo usa flags se passadas)
    apply_agent_zero_toggle(gateway_url, agz_direct)
    try:
        sender.send_bulk(phones, message, media_url if media_url else None)
    except KeyboardInterrupt:
        print("\n\n⚠️ Envio interrompido pelo usuário (Ctrl+C)")
    except Exception as e:
        print(f"\n❌ Erro inesperado: {str(e)}")

def apply_agent_zero_toggle(gateway_url: Optional[str], agz_direct: Optional[bool]):
    """Se gateway_url e agz_direct fornecidos, faz POST no endpoint de toggle antes do envio.
    Não falha o processo em caso de erro, apenas loga."""
    if not gateway_url or agz_direct is None:
        return
    try:
        resp = requests.post(gateway_url.rstrip('/') + '/agent-zero/direct', json={"enabled": bool(agz_direct)}, timeout=5)
        if resp.ok:
            data = resp.json()
            print(f"⚙️ Agent Zero direct agora: {'ON' if data.get('enabled') else 'OFF'} (gateway {gateway_url})")
        else:
            print(f"⚠️ Falha ao alternar Agent Zero direct (HTTP {resp.status_code})")
    except Exception as e:
        print(f"⚠️ Erro toggle Agent Zero direct: {e}")

def parse_args():
    parser = argparse.ArgumentParser(description='WhatsApp Bulk Sender')
    parser.add_argument('--api-url', default='http://efnh.skincos.com.br', help='URL da API de envio (endpoint /send)')
    parser.add_argument('--gateway-url', help='URL do gateway WhatsApp (para toggle /agent-zero/direct) ex: http://localhost:3001')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--agent-zero', dest='agent_zero', action='store_true', help='Ativar Agent Zero direct antes do envio')
    group.add_argument('--no-agent-zero', dest='agent_zero', action='store_false', help='Desativar Agent Zero direct antes do envio')
    parser.set_defaults(agent_zero=None)  # se não passado, não toca no toggle
    parser.add_argument('--mensagem', help='Mensagem direta (pula prompt interativo)')
    parser.add_argument('--midia', help='URL mídia opcional (pula prompt)')
    parser.add_argument('--numeros', help='Lista números separados por vírgula (pula prompts de entrada)')
    parser.add_argument('--arquivo', help='Arquivo com números (.csv, .xlsx, .xls, .pdf, .txt)')
    parser.add_argument('--force-upload', action='store_true', help='Força upload Cloudinary se mídia for caminho local (mesmo que detecção falhe)')
    return parser.parse_args()

def main():
    args = parse_args()
    print("🚀 WhatsApp Bulk Sender")
    print("=" * 50)
    sender = WhatsAppBulkSender(api_url=args.api_url)

    # Caminho rápido não interativo se todos parâmetros fornecidos
    if args.mensagem and (args.numeros or args.arquivo):
        message = args.mensagem
        media_url = args.midia
        # Diagnóstico de mídia local
        if media_url:
            # Normalizar remoção de quebras de linha inadvertidas
            if '\n' in media_url or '\r' in media_url:
                print('⚠️  Caminho de mídia continha quebras de linha; normalizando.')
                media_url = media_url.replace('\n','').replace('\r','')
            raw_path = media_url.strip().strip('"').strip("'")
            from pathlib import Path as _P
            p = _P(raw_path)
            detected_local = WhatsAppBulkSender().is_local_media_path(media_url)
            if args.force_upload:
                print("🔧 --force-upload ativado. Forçando tentativa de upload Cloudinary.")
            print(f"🔎 Caminho mídia: {raw_path}\n    exists={p.exists()} is_file={p.is_file()} detected_local={'SIM' if detected_local else 'NÃO'}")
            try:
                media_url_uploaded = WhatsAppBulkSender().upload_media_if_local(media_url, force=args.force_upload)
                if media_url_uploaded and media_url_uploaded != media_url:
                    print(f"☁️  Upload Cloudinary OK: {media_url_uploaded}")
                    media_url = media_url_uploaded
            except Exception as e:
                print(f"❌ Falha upload Cloudinary: {e}")
                return
        phones: List[str] = []
        if args.numeros:
            phones = sender.parse_phone_list(args.numeros)
        if args.arquivo:
            phones_from_file = sender.read_phones_from_file(args.arquivo)
            phones = list(set(phones + phones_from_file))
        if not phones:
            print('❌ Nenhum número válido fornecido!')
            return
        sender.display_summary(phones, message, media_url if media_url else None)
        apply_agent_zero_toggle(args.gateway_url, args.agent_zero)
        print('\n⚠️ Prosseguir imediatamente? (s/N)')
        confirm = input('> ').strip().lower()
        if confirm != 's':
            print('❌ Envio cancelado.')
            return
        try:
            sender.send_bulk(phones, message, media_url if media_url else None)
        except KeyboardInterrupt:
            print('\n\n⚠️ Envio interrompido (Ctrl+C)')
        return

    # Fluxo interativo
    interactive_flow(sender, args.gateway_url, args.agent_zero)

if __name__ == "__main__":
    main()

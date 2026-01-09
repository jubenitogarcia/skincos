#!/usr/bin/env python3
"""
📊 Terminal Output Analyzer
Extrai informações de sucessos e falhas do output do WhatsApp Bulk Sender
"""

import re
import csv
import json
from datetime import datetime
from typing import List, Dict, Tuple

class TerminalOutputAnalyzer:
    def __init__(self):
        self.successful_numbers = []
        self.failed_numbers = []

    def parse_terminal_output(self, terminal_text: str) -> Tuple[List[str], List[Dict]]:
        """Analisa o output do terminal e extrai sucessos e falhas"""

        lines = terminal_text.split('\n')

        for line in lines:
            line = line.strip()

            # Buscar por linhas de sucesso: "✅ 51999999999: Enviado com sucesso"
            success_match = re.search(r'✅\s*(\d{10,15}):\s*Enviado com sucesso', line)
            if success_match:
                phone = success_match.group(1)
                self.successful_numbers.append(phone)
                continue

            # Buscar por linhas de falha: "❌ 51999999999: Erro 400" ou "❌ 51999999999: Erro - mensagem"
            error_match = re.search(r'❌\s*(\d{10,15}):\s*(Erro.*)', line)
            if error_match:
                phone = error_match.group(1)
                error_msg = error_match.group(2)
                self.failed_numbers.append({
                    'phone': phone,
                    'error': error_msg
                })
                continue

        return self.successful_numbers, self.failed_numbers

    def generate_report_from_terminal(self, terminal_text: str, message: str = "Mensagem extraída do terminal"):
        """Gera relatório a partir do output do terminal"""

        self.successful_numbers = []
        self.failed_numbers = []

        # Analisar o texto
        successful, failed = self.parse_terminal_output(terminal_text)

        # Gerar timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Criar diretório se não existir
        import os
        if not os.path.exists("relatorios"):
            os.makedirs("relatorios")

        # Gerar relatórios
        self.generate_csv_from_terminal(f"relatorios/terminal_output_{timestamp}.csv", message, successful, failed)
        self.generate_json_from_terminal(f"relatorios/terminal_output_{timestamp}.json", message, successful, failed)
        self.generate_txt_from_terminal(f"relatorios/terminal_output_{timestamp}.txt", message, successful, failed)

        print(f"\n📋 RELATÓRIOS GERADOS A PARTIR DO TERMINAL:")
        print(f"   📄 CSV: relatorios/terminal_output_{timestamp}.csv")
        print(f"   📄 JSON: relatorios/terminal_output_{timestamp}.json")
        print(f"   📄 TXT: relatorios/terminal_output_{timestamp}.txt")

        return successful, failed

    def generate_csv_from_terminal(self, file_path: str, message: str, successful: List[str], failed: List[Dict]):
        """Gera relatório CSV"""
        with open(file_path, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)

            # Cabeçalho
            writer.writerow(['=== RELATÓRIO EXTRAÍDO DO TERMINAL ==='])
            writer.writerow([f'Data/Hora: {datetime.now().strftime("%d/%m/%Y %H:%M:%S")}'])
            writer.writerow([f'Mensagem: {message}'])
            writer.writerow([f'Total Sucessos: {len(successful)}'])
            writer.writerow([f'Total Falhas: {len(failed)}'])
            writer.writerow([f'Taxa de Sucesso: {(len(successful)/(len(successful)+len(failed))*100):.1f}%'])
            writer.writerow([])

            # Sucessos
            writer.writerow(['=== NÚMEROS COM SUCESSO ==='])
            writer.writerow(['Telefone', 'Status'])
            for phone in successful:
                writer.writerow([phone, 'Enviado com sucesso'])

            writer.writerow([])

            # Falhas
            writer.writerow(['=== NÚMEROS COM FALHA ==='])
            writer.writerow(['Telefone', 'Erro'])
            for fail in failed:
                writer.writerow([fail['phone'], fail['error']])

    def generate_json_from_terminal(self, file_path: str, message: str, successful: List[str], failed: List[Dict]):
        """Gera relatório JSON"""
        total = len(successful) + len(failed)
        success_rate = (len(successful) / total * 100) if total > 0 else 0

        report_data = {
            "relatorio_info": {
                "fonte": "terminal_output",
                "timestamp": datetime.now().isoformat(),
                "mensagem": message,
                "taxa_sucesso": success_rate,
                "total_numeros": total,
                "sucessos": len(successful),
                "falhas": len(failed)
            },
            "numeros_sucesso": successful,
            "numeros_falha": failed
        }

        with open(file_path, 'w', encoding='utf-8') as jsonfile:
            json.dump(report_data, jsonfile, indent=2, ensure_ascii=False)

    def generate_txt_from_terminal(self, file_path: str, message: str, successful: List[str], failed: List[Dict]):
        """Gera relatório TXT"""
        total = len(successful) + len(failed)
        success_rate = (len(successful) / total * 100) if total > 0 else 0

        with open(file_path, 'w', encoding='utf-8') as txtfile:
            txtfile.write("=" * 60 + "\n")
            txtfile.write("📱 RELATÓRIO EXTRAÍDO DO TERMINAL\n")
            txtfile.write("=" * 60 + "\n\n")

            txtfile.write(f"📅 Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
            txtfile.write(f"📝 Mensagem: {message}\n")
            txtfile.write(f"📊 Taxa de Sucesso: {success_rate:.1f}%\n\n")

            # Estatísticas
            txtfile.write("📈 ESTATÍSTICAS:\n")
            txtfile.write(f"   📞 Total de números: {total}\n")
            txtfile.write(f"   ✅ Sucessos: {len(successful)}\n")
            txtfile.write(f"   ❌ Falhas: {len(failed)}\n\n")

            # Sucessos
            if successful:
                txtfile.write("✅ NÚMEROS COM SUCESSO:\n")
                txtfile.write("-" * 40 + "\n")
                for i, phone in enumerate(successful, 1):
                    txtfile.write(f"{i:3d}. {phone}\n")
                txtfile.write("\n")

            # Falhas
            if failed:
                txtfile.write("❌ NÚMEROS COM FALHA:\n")
                txtfile.write("-" * 40 + "\n")
                for i, fail in enumerate(failed, 1):
                    txtfile.write(f"{i:3d}. {fail['phone']}\n")
                    txtfile.write(f"     Erro: {fail['error']}\n")
                txtfile.write("\n")

            txtfile.write("=" * 60 + "\n")
            txtfile.write("Relatório gerado a partir do output do terminal\n")
            txtfile.write("=" * 60 + "\n")

def main():
    """Função principal para uso interativo"""
    print("📊 Terminal Output Analyzer")
    print("=" * 50)

    print("\n📋 Cole aqui o output do terminal do WhatsApp Bulk Sender:")
    print("💡 Pressione Enter duas vezes quando terminar")

    lines = []
    empty_lines = 0

    while True:
        try:
            line = input()
            if line.strip() == "":
                empty_lines += 1
                if empty_lines >= 2:
                    break
            else:
                empty_lines = 0
                lines.append(line)
        except KeyboardInterrupt:
            break

    if not lines:
        print("❌ Nenhum texto fornecido!")
        return

    terminal_text = "\n".join(lines)

    # Solicitar informações adicionais
    print("\n📝 Digite a mensagem que foi enviada (ou ENTER para usar padrão):")
    message = input("> ").strip()
    if not message:
        message = "Mensagem extraída do terminal"

    # Analisar e gerar relatórios
    analyzer = TerminalOutputAnalyzer()
    successful, failed = analyzer.generate_report_from_terminal(terminal_text, message)

    # Mostrar resumo
    total = len(successful) + len(failed)
    if total > 0:
        success_rate = len(successful) / total * 100
        print(f"\n📊 RESUMO:")
        print(f"   ✅ Sucessos: {len(successful)}")
        print(f"   ❌ Falhas: {len(failed)}")
        print(f"   📈 Taxa: {success_rate:.1f}%")
    else:
        print("\n❌ Nenhum número encontrado no texto!")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
🌅 Teste completo das metas da manhã de Novo Hamburgo
Inclui dados de vendas, metas e gráfico
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_nh_morning_complete():
    print("🌅 Testando envio completo das metas da manhã - Novo Hamburgo")
    print("=" * 60)

    try:
        # Importar módulos necessários
        from automation.messages import MessageGenerator
        from whatsapp_bulk_sender import WhatsAppBulkSender

        # Dados de exemplo para NH manhã (formato completo)
        sales_values = {
            "venda_hoje": "85000",          # Vendas de hoje até agora
            "vendas_ontem": "95000",        # Vendas de ontem completo
            "vendas_semana": "420000",      # Vendas da semana até agora
            "meta_1a": "75000",             # 1ª meta do dia
            "meta_2a": "95000",             # 2ª meta do dia
            "meta_3a": "110000",            # 3ª meta do dia
            "meta_super": "130000",         # Meta super
            "vendedores_ativos": "8",       # Número de vendedores
            "conversao": "15.2%",           # Taxa de conversão
            "ticket_medio": "2850"          # Ticket médio
        }

        cell_set = "NH"
        period = "morning"

        # Status das metas
        metas_atingidas = {
            "meta_1a": True,               # 1ª meta atingida
            "meta_2a": False,              # 2ª meta ainda não
            "meta_3a": False,              # 3ª meta ainda não
            "meta_super": False,           # Meta super ainda não
            "meta_diaria": False,          # Meta diária geral
            "meta_semanal": True           # Meta semanal OK
        }

        # URL do gráfico (QuickChart ou similar)
        chart_image_url = "https://quickchart.io/chart?c={type:'bar',data:{labels:['1ª Meta','2ª Meta','3ª Meta','Super'],datasets:[{label:'Meta',data:[75000,95000,110000,130000],backgroundColor:'rgba(54,162,235,0.5)'},{label:'Atual',data:[85000,85000,85000,85000],backgroundColor:'rgba(255,99,132,0.5)'}]},options:{responsive:true,plugins:{title:{display:true,text:'Metas NH - Manhã'}}}}"

        print(f"📊 Dados de vendas:")
        for key, value in sales_values.items():
            print(f"   {key}: {value}")
        print(f"\n🎯 Equipe: {cell_set}")
        print(f"🌅 Período: {period}")
        print(f"✅ Status das metas:")
        for meta, status in metas_atingidas.items():
            emoji = "✅" if status else "⏳"
            print(f"   {emoji} {meta}: {'Atingida' if status else 'Pendente'}")
        print(f"\n📈 Gráfico: {chart_image_url[:60]}...")
        print()

        # Gerar mensagem com Agent-Zero
        print("🎯 Gerando mensagem com Agent-Zero...")
        generator = MessageGenerator()

        message_content = generator.generate(
            values=sales_values,
            cell_set=cell_set,
            period=period,
            metas_atingidas=metas_atingidas,
            chart_image_url=chart_image_url
        )

        if message_content:
            print("✅ Mensagem gerada com sucesso!")
            print("📝 Conteúdo da mensagem:")
            print("-" * 40)
            print(message_content)
            print("-" * 40)
            print()

            # Testar envio com WhatsApp Bulk Sender
            print("📱 Testando envio via WhatsApp...")

            # Números de teste (funcionários NH)
            test_numbers = [
                "51999999999",  # Gerente
                "51888888888",  # Supervisor
                "51777777777",  # Vendedor 1
            ]

            # sender = WhatsAppBulkSender()

            print(f"📞 Números de teste: {len(test_numbers)}")
            print(f"📎 Mídia: {chart_image_url[:50]}...")

            # Simular envio (sem realmente enviar)
            print("\n🧪 SIMULAÇÃO DE ENVIO:")
            for i, phone in enumerate(test_numbers, 1):
                print(f"  📤 [{i}/{len(test_numbers)}] Simulando envio para {phone}...")
                print(f"    ✅ {phone}: Enviado com sucesso (SIMULADO)")

            print("\n🎉 TESTE COMPLETO FINALIZADO!")
            print("📋 Resumo:")
            print(f"   📊 Dados: {len(sales_values)} métricas")
            print(f"   🎯 Metas: {sum(metas_atingidas.values())}/{len(metas_atingidas)} atingidas")
            print(f"   📱 Envios: {len(test_numbers)} números testados")
            print(f"   📈 Gráfico: Incluído")

        else:
            print("❌ Erro na geração da mensagem")
            print(f"Resposta: {message_content}")

    except ImportError as e:
        print(f"❌ Erro de importação: {e}")
        print("💡 Verifique se os módulos estão disponíveis")
    except Exception as e:
        print(f"❌ Erro inesperado: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_nh_morning_complete()

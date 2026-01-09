/**
 * ============================================================================
 * WIX FRONTEND - Formulário de Inscrição com Polling
 * ============================================================================
 *
 * Este arquivo deve ser copiado para a página do formulário no Wix Editor
 *
 * Elementos necessários na página (IDs):
 * - #eventInvite - Wix Form (formulário de inscrição)
 * - #sendButton - Botão de envio
 * - #progressBarContainer - Box que contém a barra (inicialmente oculto)
 * - #progressBarFill - Barra de progresso (elemento visual)
 * - #errorMessage - Texto para erros (opcional)
 *
 * Campos do formulário (fieldName):
 * - name, email, phone, cpf, bday, gender, shirtSize
 *
 * ============================================================================
 */

import { processarInscricao } from 'backend/sendToWebhook';
import wixLocation from 'wix-location';
import { fetch } from 'wix-fetch';

let pollingInterval = null;
let progressInterval = null;
let userEmail = null;

$w.onReady(function () {

    const button = $w("#sendButton");
    const progressBar = $w("#progressBarFill");
    const progressBarContainer = $w("#progressBarContainer");

    console.log('✅ Página carregada - Formulário pronto');

    // ============================================================================
    // Evento de submit do formulário Wix Form
    // ============================================================================
    $w("#eventInvite").onWixFormSubmitted(async (event) => {

        console.log('📋 Formulário submetido');
        console.log('🔍 Dados do evento:', event);

        // Desabilitar botão imediatamente
        button.disable();
        button.label = "Enviando...";

        try {
            // 1️⃣ Coletar dados do formulário submetido
            const dados = {
                name: event.fields.find(f => f.fieldName === 'name')?.value || '',
                email: event.fields.find(f => f.fieldName === 'email')?.value || '',
                phone: event.fields.find(f => f.fieldName === 'phone')?.value?.replace(/\D/g, '') || '',
                cpf: event.fields.find(f => f.fieldName === 'cpf')?.value?.replace(/\D/g, '') || '',
                bday: formatarData(event.fields.find(f => f.fieldName === 'bday')?.value),
                gender: event.fields.find(f => f.fieldName === 'gender')?.value || '',
                shirtSize: event.fields.find(f => f.fieldName === 'shirtSize')?.value || '',
                team: "Espaço Facial"
            };

            userEmail = dados.email.toLowerCase().trim();

            console.log('✅ Dados coletados:', {
                ...dados,
                cpf: '***',
                phone: '***'
            });

            // 2️⃣ Validar dados mínimos
            if (!dados.name || !dados.email) {
                throw new Error('Nome e email são obrigatórios');
            }

            // 3️⃣ Enviar para GitHub (backend commita CSV)
            console.log('📤 Enviando para GitHub...');
            const resultado = await processarInscricao(dados);

            if (resultado.success) {

                console.log('✅ CSV enviado para GitHub com sucesso');
                console.log('🔗 Commit SHA:', resultado.commitSha);

                // 4️⃣ Mostrar barra de progresso após 2.5s (delay visual)
                setTimeout(() => {
                    progressBarContainer.show("fade", { duration: 1000 })
                        .then(() => {
                            console.log('📊 Iniciando barra de progresso e polling');
                            // 5️⃣ Iniciar barra de progresso E polling simultaneamente
                            iniciarBarraDeProgressoComPolling(userEmail);
                        });
                }, 2500);

            } else {
                throw new Error(resultado.message || 'Erro ao processar inscrição');
            }

        } catch (error) {
            console.error('❌ Erro ao enviar inscrição:', error);

            // Mostrar mensagem de erro
            if ($w("#errorMessage")) {
                $w("#errorMessage").text = `Erro: ${error.message}. Por favor, tente novamente.`;
                $w("#errorMessage").show();
            }

            // Reabilitar botão
            button.enable();
            button.label = "Enviar Inscrição";
        }
    });

});

/**
 * ============================================================================
 * Inicia barra de progresso (30s) E polling (verifica URL a cada 1s)
 * ============================================================================
 */
function iniciarBarraDeProgressoComPolling(email) {

    const totalDuration = 30; // 30 segundos de barra visual
    let elapsed = 0;
    let checkoutUrlEncontrada = false;

    // Configurar barra de progresso
    const progressBar = $w("#progressBarFill");
    progressBar.show();
    progressBar.style.width = "0%";
    progressBar.style.transition = "width 1s linear";

    console.log('⏱️  Barra de progresso: 30 segundos');
    console.log('🔄 Polling iniciado para:', email);

    // ========================================
    // INTERVALO 1: Barra de Progresso (visual)
    // ========================================
    progressInterval = setInterval(() => {
        elapsed++;
        const percent = (elapsed / totalDuration) * 100;
        progressBar.style.width = `${percent}%`;

        if (elapsed % 5 === 0) {
            console.log(`📊 Progresso visual: ${percent.toFixed(0)}% (${elapsed}s/${totalDuration}s)`);
        }

        // Se chegou a 30s e ainda não encontrou URL
        if (elapsed >= totalDuration && !checkoutUrlEncontrada) {
            clearInterval(progressInterval);

            if (pollingInterval) {
                console.log('⏳ 30s completados, mas polling continua (até 60s total)');
                // Polling continua por mais 30s (total: 60s)
            } else {
                console.log('⏱️  Timeout - redirecionando para página de confirmação');
                wixLocation.to("/inscricao-confirmada");
            }
        }

    }, 1000); // Atualizar barra a cada 1 segundo

    // ========================================
    // INTERVALO 2: Polling de URL (backend)
    // ========================================
    let tentativasPolling = 0;
    const maxTentativasPolling = 60; // 60 segundos total

    pollingInterval = setInterval(async () => {
        tentativasPolling++;

        try {
            // Verificar se checkout URL está pronta no Web Module
            const url = `/_functions-dev/checkoutWebhook/checkStatus?email=${encodeURIComponent(email)}`;
            const response = await fetch(url);
            const data = await response.json();

            if (tentativasPolling % 5 === 0) {
                console.log(`🔍 Polling ${tentativasPolling}/${maxTentativasPolling}: ${data.ready ? 'PRONTO' : 'aguardando...'}`);
            }

            if (data.ready && data.checkoutUrl) {
                // ✅ URL ENCONTRADA! REDIRECIONAR IMEDIATAMENTE!

                console.log('🎉 CHECKOUT URL RECEBIDA!');
                console.log('🔗 URL:', data.checkoutUrl);
                console.log('🎟️  Desconto:', data.discount);
                console.log('⏱️  Tempo decorrido:', data.elapsedSeconds, 'segundos');

                checkoutUrlEncontrada = true;

                // Parar ambos os intervalos
                clearInterval(pollingInterval);
                clearInterval(progressInterval);

                // Completar barra de progresso visualmente
                progressBar.style.width = "100%";

                // Aguardar 1 segundo e redirecionar
                setTimeout(() => {
                    console.log('🚀 Redirecionando para checkout...');
                    wixLocation.to(data.checkoutUrl);
                }, 1000);

            } else if (response.status === 410) {
                // ⏱️ URL expirou (mais de 5 minutos)

                console.error('❌ URL expirada (mais de 5 minutos desde o processamento)');

                clearInterval(pollingInterval);
                clearInterval(progressInterval);

                // Redirecionar para página de erro/nova inscrição
                wixLocation.to("/inscricao-expirada");

            } else if (tentativasPolling >= maxTentativasPolling) {
                // ⏱️ Timeout total (60 segundos de polling)

                console.warn('⏱️  Timeout de polling atingido (60 segundos)');
                console.log('📧 Usuário receberá email com link de pagamento');

                clearInterval(pollingInterval);
                clearInterval(progressInterval);

                // Redirecionar para página de confirmação
                wixLocation.to("/inscricao-confirmada");
            }

        } catch (error) {
            console.error('❌ Erro no polling:', error);

            // Se chegou ao máximo de tentativas, parar e redirecionar
            if (tentativasPolling >= maxTentativasPolling) {
                clearInterval(pollingInterval);
                clearInterval(progressInterval);

                console.error('❌ Erro persistente - redirecionando para página de erro');
                wixLocation.to("/erro-processamento");
            }
        }

    }, 1000); // Verificar a cada 1 segundo

}

/**
 * Formata data para DD/MM/YYYY
 */
function formatarData(dateObj) {
    if (!dateObj) return '';

    try {
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (error) {
        console.error('❌ Erro ao formatar data:', error);
        return '';
    }
}

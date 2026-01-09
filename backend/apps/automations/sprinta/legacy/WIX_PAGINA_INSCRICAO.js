import { enviarInscricaoParaGitHub } from 'backend/github-inscricoes';
import wixData from 'wix-data';
import wixLocation from 'wix-location';

$w.onReady(function () {

    $w("#submitButton").onClick(async () => {

        // Desabilitar botão durante processamento
        $w("#submitButton").disable();
        $w("#submitButton").label = "Processando...";
        $w("#loadingIcon").show();  // Se tiver um ícone de loading

        try {
            // 1️⃣ Coletar dados do formulário
            const dados = {
                name: $w("#nameInput").value.trim(),
                email: $w("#emailInput").value.trim().toLowerCase(),
                phone: $w("#phoneInput").value.replace(/\D/g, ''),
                cpf: $w("#cpfInput").value.replace(/\D/g, ''),
                bday: formatarData($w("#bdayInput").value),
                gender: $w("#genderDropdown").value,  // 'm' ou 'f'
                shirtSize: $w("#shirtSizeDropdown").value,  // P, M, G, GG, XG
                team: $w("#teamInput").value || "Espaço Facial"
            };

            console.log('📋 Dados coletados:', dados);

            // 2️⃣ Enviar para GitHub (cria CSV e dispara processamento)
            $w("#statusMessage").text = "Enviando inscrição...";
            $w("#statusMessage").show();

            const resultado = await enviarInscricaoParaGitHub(dados);

            if (resultado.success) {
                // ✅ SUCESSO - CSV foi commitado!

                console.log('✅ Inscrição enviada com sucesso!');
                console.log('🔗 Commit:', resultado.commitSha);
                console.log('📧 ID do participante:', resultado.participantId);

                // Mostrar mensagem de sucesso
                $w("#successMessage").text = 'Inscrição enviada com sucesso! Estamos processando...';
                $w("#successMessage").show();
                $w("#statusMessage").text = 'Processamento em andamento. Você receberá um email em breve.';

                // ⭐ OPÇÃO 1: Redirecionar para página de "Aguarde"
                console.log('🔄 Redirecionando para página de confirmação...');
                setTimeout(() => {
                    wixLocation.to('/inscricao-confirmada');  // Crie esta página no Wix
                }, 2000);  // 2 segundos

                // ⭐ OPÇÃO 2: Aguardar alguns segundos e buscar resultado
                // (O webhook já atualizou o banco de dados)
                /*
                setTimeout(async () => {
                    const updated = await wixData.get("Participants", resultado.participantId);
                    if (updated.checkoutUrl) {
                        wixLocation.to(updated.checkoutUrl);
                    }
                }, 15000);  // 15 segundos
                */

            } else {
                // ❌ ERRO ao enviar para GitHub
                console.error('❌ Falha:', resultado);

                $w("#errorMessage").text = resultado.message || 'Erro ao processar inscrição';
                $w("#errorMessage").show();
                $w("#statusMessage").hide();

                // Reabilitar botão
                $w("#submitButton").enable();
                $w("#submitButton").label = "Enviar Inscrição";
            }

        } catch (error) {
            console.error('❌ Erro geral:', error);

            $w("#errorMessage").text = 'Erro ao processar. Tente novamente.';
            $w("#errorMessage").show();
            $w("#statusMessage").hide();

            // Reabilitar botão
            $w("#submitButton").enable();
            $w("#submitButton").label = "Enviar Inscrição";

        } finally {
            $w("#loadingIcon").hide();
        }
    });

});

/**
 * Formata data para DD/MM/YYYY
 */
function formatarData(dateObj) {
    if (!dateObj) return '';

    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();

    return `${day}/${month}/${year}`;
}

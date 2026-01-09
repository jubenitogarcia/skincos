/**
 * ============================================================================
 * WIX WEB MODULE - Checkout Webhook Receiver
 * ============================================================================
 *
 * Este arquivo deve ser copiado para o Wix Editor:
 * 1. Abra Wix Editor
 * 2. Vá em Code (ícone </>)
 * 3. Backend → New Web Module
 * 4. Nome: checkoutWebhook.web.js
 * 5. Cole este código
 *
 * URLs geradas automaticamente após publicar:
 * - POST: https://SEU_SITE.wixsite.com/SITE_NAME/_functions-dev/checkoutWebhook/receiveCheckout
 * - GET:  https://SEU_SITE.wixsite.com/SITE_NAME/_functions-dev/checkoutWebhook/checkStatus?email=...
 *
 * ============================================================================
 */

// Armazena URLs temporariamente em memória (por email)
const checkoutUrls = new Map();

/**
 * ============================================================================
 * POST - Recebe resultado do GitHub Actions
 * ============================================================================
 *
 * Chamado pelo GitHub Actions após processar inscrição com Selenium
 *
 * Payload esperado:
 * {
 *   "success": true,
 *   "processed_at": "2025-10-03T20:30:00Z",
 *   "results": [
 *     {
 *       "name": "João Silva",
 *       "email": "joao@example.com",
 *       "checkout_url": "https://sprinta.com.br/checkout/abc123",
 *       "discount_applied": "ESPACOFACIALNH10",
 *       "success": true
 *     }
 *   ]
 * }
 */
export async function post_receiveCheckout(request) {
    try {
        const payload = await request.body.json();

        console.log('📥 Webhook recebido do GitHub Actions');
        console.log('📦 Payload:', JSON.stringify(payload, null, 2));

        // Validar estrutura do payload
        if (!payload || !payload.results || !Array.isArray(payload.results)) {
            console.error('❌ Payload inválido - estrutura incorreta');
            return new Response(JSON.stringify({
                success: false,
                error: 'Payload inválido',
                expected: '{ results: [...] }'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Processar cada resultado (normalmente será apenas 1)
        const processados = [];

        for (const result of payload.results) {
            if (result && result.checkout_url && result.email) {
                const email = result.email.toLowerCase().trim();
                const checkoutUrl = result.checkout_url;

                // Armazenar URL com timestamp e metadados
                checkoutUrls.set(email, {
                    url: checkoutUrl,
                    timestamp: Date.now(),
                    discount: result.discount_applied || 'ESPACOFACIALNH10',
                    success: result.success || true,
                    name: result.name || '',
                    receivedAt: new Date().toISOString()
                });

                console.log(`✅ URL armazenada para ${email}`);
                console.log(`🔗 Checkout URL: ${checkoutUrl}`);
                console.log(`🎟️  Desconto: ${result.discount_applied || 'ESPACOFACIALNH10'}`);

                processados.push({
                    email: email,
                    stored: true,
                    checkoutUrl: checkoutUrl
                });
            } else {
                console.warn('⚠️  Resultado sem checkout_url ou email:', result);
                processados.push({
                    email: result?.email || 'unknown',
                    stored: false,
                    error: 'checkout_url ou email ausente'
                });
            }
        }

        console.log(`✅ Processamento concluído: ${processados.length} resultado(s)`);

        // Retornar sucesso
        return new Response(JSON.stringify({
            success: true,
            message: 'Webhook processado com sucesso',
            timestamp: new Date().toISOString(),
            processed: processados.length,
            stored: processados.filter(p => p.stored).length,
            results: processados
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ Erro ao processar webhook:', error);
        console.error('Stack trace:', error.stack);

        return new Response(JSON.stringify({
            success: false,
            error: 'Erro interno do servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * ============================================================================
 * GET - Verifica se checkout URL está pronta
 * ============================================================================
 *
 * Chamado pelo frontend via polling para verificar se URL chegou
 *
 * Query params: ?email=usuario@example.com
 *
 * Respostas possíveis:
 * - 200: URL encontrada (ready: true, checkoutUrl: "...")
 * - 202: Ainda processando (ready: false, message: "Processando...")
 * - 400: Email não fornecido (ready: false, error: "...")
 * - 410: URL expirada (ready: false, error: "URL expirada")
 */
export async function get_checkStatus(request) {
    try {
        // Extrair email da query string
        const url = new URL(request.url);
        const email = url.searchParams.get('email')?.toLowerCase()?.trim();

        if (!email) {
            console.warn('⚠️  GET checkStatus: email não fornecido');
            return new Response(JSON.stringify({
                ready: false,
                error: 'Parâmetro email é obrigatório',
                usage: '?email=usuario@example.com'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log(`🔍 Verificando status para: ${email}`);

        // Buscar dados armazenados
        const data = checkoutUrls.get(email);

        if (!data) {
            // URL ainda não chegou - ainda processando
            console.log(`⏳ URL ainda não disponível para ${email}`);
            return new Response(JSON.stringify({
                ready: false,
                message: 'Processando... aguarde',
                email: email
            }), {
                status: 202, // Accepted (processando)
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Verificar se expirou (5 minutos = 300000 ms)
        const EXPIRATION_TIME = 5 * 60 * 1000;
        const elapsed = Date.now() - data.timestamp;

        if (elapsed > EXPIRATION_TIME) {
            console.warn(`⏱️  URL expirada para ${email} (${Math.floor(elapsed / 1000)}s)`);

            // Remover da memória
            checkoutUrls.delete(email);

            return new Response(JSON.stringify({
                ready: false,
                error: 'URL expirada (mais de 5 minutos)',
                message: 'Por favor, faça uma nova inscrição',
                elapsedSeconds: Math.floor(elapsed / 1000)
            }), {
                status: 410, // Gone
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ✅ URL ENCONTRADA E VÁLIDA!
        console.log(`✅ URL pronta para ${email}: ${data.url}`);

        // Remover da memória após recuperar (single-use)
        checkoutUrls.delete(email);

        return new Response(JSON.stringify({
            ready: true,
            checkoutUrl: data.url,
            discount: data.discount,
            name: data.name,
            receivedAt: data.receivedAt,
            elapsedSeconds: Math.floor(elapsed / 1000)
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ Erro ao verificar status:', error);
        console.error('Stack trace:', error.stack);

        return new Response(JSON.stringify({
            ready: false,
            error: 'Erro interno do servidor',
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * ============================================================================
 * UTILITY - Limpar URLs expiradas (opcional)
 * ============================================================================
 *
 * Pode ser chamado periodicamente por um job scheduler
 * Não é essencial pois URLs são removidas automaticamente ao serem acessadas
 */
export async function post_cleanup(request) {
    try {
        const now = Date.now();
        const EXPIRATION_TIME = 5 * 60 * 1000; // 5 minutos
        let cleaned = 0;

        for (const [email, data] of checkoutUrls.entries()) {
            if (now - data.timestamp > EXPIRATION_TIME) {
                checkoutUrls.delete(email);
                cleaned++;
            }
        }

        console.log(`🧹 Limpeza: ${cleaned} URL(s) expirada(s) removida(s)`);

        return new Response(JSON.stringify({
            success: true,
            message: 'Limpeza concluída',
            cleaned: cleaned,
            remaining: checkoutUrls.size
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ Erro na limpeza:', error);

        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * ============================================================================
 * DEBUG - Status do sistema (opcional)
 * ============================================================================
 */
export async function get_status(request) {
    return new Response(JSON.stringify({
        status: 'online',
        storedUrls: checkoutUrls.size,
        timestamp: new Date().toISOString(),
        message: 'Checkout Webhook Web Module está funcionando corretamente'
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

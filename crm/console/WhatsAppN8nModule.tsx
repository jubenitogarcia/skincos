import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Badge } from '@/badge'

const webhookPath = '/webhook/wa/inbound/evolution'
const webhookTestPath = '/webhook-test/wa/inbound/evolution'

export function WhatsAppN8nModule({ embedded = false }: { embedded?: boolean } = {}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const fullWebhookPath = origin ? `${origin}${webhookPath}` : webhookPath
  const fullWebhookTestPath = origin ? `${origin}${webhookTestPath}` : webhookTestPath

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">WhatsApp n8n · Agendamentos</h2>
            <p className="text-sm text-blue-100/70">Evolution API → n8n → Postgres → Google Calendar</p>
          </div>
          <Badge variant="secondary">MVP</Badge>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white">Workflows n8n</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-blue-100/80">
            <div><strong>01</strong> Inbound Triagem</div>
            <div><strong>02</strong> Agendamento</div>
            <div><strong>03</strong> Lembretes + Follow-ups</div>
            <div><strong>04</strong> No-show + Reativação</div>
            <div className="pt-2 text-xs text-blue-100/60">
              Local: <code>n8n/workflows</code>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white">Webhooks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-blue-100/80">
            <div>Produção: <code>{fullWebhookPath}</code></div>
            <div>Teste: <code>{fullWebhookTestPath}</code></div>
            <div className="pt-2 text-xs text-blue-100/60">
              Configure a Evolution API para apontar para o webhook acima.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Setup rápido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-blue-100/80">
          <div>1) Rodar migration SQL em Postgres</div>
          <div>2) Importar JSONs no n8n</div>
          <div>3) Criar credenciais: Postgres + Google Calendar</div>
          <div>4) Ajustar envs em <code>n8n/.env.example</code></div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Teste rápido (inbound)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-100/80">
          <pre className="whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs">
{`curl -X POST http://localhost:5678/webhook-test/wa/inbound/evolution \\
  -H 'Content-Type: application/json' \\
  -d @n8n/sample_payloads/evolution_inbound_message.json`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

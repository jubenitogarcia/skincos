# ✨ Welcome to Your Spark Template!
You've just launched your brand-new Spark Template Codespace — everything’s fired up and ready for you to explore, build, and create with Spark!

This template is your blank canvas. It comes with a minimal setup to help you get started quickly with Spark development.

🚀 What's Inside?
- A clean, minimal Spark environment
- Pre-configured for local development
- Ready to scale with your ideas

🧠 What Can You Do?

Right now, this is just a starting point — the perfect place to begin building and testing your Spark applications.

🧹 Just Exploring?
No problem! If you were just checking things out and don’t need to keep this code:

- Simply delete your Spark.
- Everything will be cleaned up — no traces left behind.

📄 License For Spark Template Resources

The Spark Template files and resources from GitHub are licensed under the terms of the MIT license, Copyright GitHub, Inc.

## 🔧 Refactor Técnico Recente (Agosto 2025)

Resumo das melhorias estruturais aplicadas ao CRM:

### 1. Normalização de Ícones
- Ícones inválidos/substituídos: `Edit`→`PencilSimple`, `DollarSign`→`CurrencyDollar`, `Send`→`PaperPlaneRight`, `Calendar`→`CalendarBlank`, `GripVertical`→`DotsSixVertical`, `Type`→`TextT`, `Wifi`→`WifiHigh`.
- Remoção de duplicações em imports (ex.: `ChartBar`, `CurrencyDollar`).
- Adicionada camada central: `src/lib/iconRegistry.ts` com `getIcon(name)` + utilidades (`registerIcon`, `validateIconName`).
 - Novos aliases adicionados: `revenue`, `currency`, `moneybag`, `funnel`, `filter`, `chart`, `analytics`.

#### Uso da Camada de Ícones
```tsx
import { getIcon } from '@/lib/iconRegistry'

const MoneyIcon = getIcon('revenue')
const FunnelIcon = getIcon('funnel')

export function Example() {
	const ChartIcon = getIcon('chart')
	return (
		<div className="flex gap-4 items-center">
			<MoneyIcon className="h-5 w-5 text-green-600" />
			<FunnelIcon className="h-5 w-5 text-blue-600" />
			<ChartIcon className="h-5 w-5 text-purple-600" />
		</div>
	)
}
```

### 2. Correção Global de Handlers de Switch
- Prop incorreta `onCheckCircleedChange` substituída por `onCheckedChange` em todos os componentes (SystemSettings, AdvancedSettings, SystemConfiguration, Tables, Permissions, etc.).

### 3. Datas e Hidratação
- `useMetaSync` agora hidrata `lastSync` para `Date` antes de cálculos.
- `IntegrationsContext` expõe `lastSyncDate` derivado para Instagram e WhatsApp.

### 4. Notification Center
- Alinhado ao shape real do `NotificationContext` (`connectionStatus`, `clearAll`, `removeNotification`).
- Ajustado filtro de não lidas para usar `notification.read`.

### 5. Tipagem Multi-Empresa
- Preenchidos campos antes ausentes (`usage`, `billing`, `subscription`, `compliance`, `language`, `updatedAt`, `subsidiaries`) para conformidade com a interface.

### 6. Prevenção de Regressões
- Introduzido registro de ícones para mapear aliases → componente válido e fallback seguro (`Question`).

### 7. Próximos Passos Sugeridos
- Integrar lint rule custom para bloquear ícones não mapeados.
- Criar testes unitários simples para `iconRegistry` e para hidratação de datas.

> Esta seção documenta o estado pós-refactor para futura manutenção e onboarding rápido.

## 🏁 Como iniciar localmente

Opção rápida (API + Frontend):

```bash
cd comprehensive-crm-so
./scripts/restart_crm.sh --tail
```

- Frontend: http://localhost:5173
- API: http://localhost:3100 (ex.: /api/conversations)

Flags úteis: `--watch` (API nodemon), `--crm-port`, `--crm-api-port`.

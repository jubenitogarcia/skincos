// Central action registry for buttons using data-action attribute
// Provides a lightweight way to bind functionality without wiring individual onClick handlers everywhere.
import { toast } from 'sonner'

type ActionHandler = (el: HTMLElement) => void

const registry: Record<string, ActionHandler> = {
    'refresh': () => { window.location.reload() },
    'go-back': () => { window.history.length > 1 ? window.history.back() : toast.info('Sem histórico anterior') },
    'open-docs': () => { window.open('/docs', '_blank', 'noreferrer') },
    'create-generic': () => { document.dispatchEvent(new CustomEvent('app:create-generic')); toast.success('Ação de criação disparada') },
    'not-implemented': (el) => { toast.info(`Ação ainda não implementada: ${(el.getAttribute('data-action') || '')}`) },
}

export function performAction(name: string, el: HTMLElement) {
    const handler = registry[name] || registry['not-implemented']
    try {
        handler(el)
    } catch (e: any) {
        console.error('[actionsRegistry] error executing action', name, e)
        toast.error('Falha executando ação: ' + name)
    }
}

// Allow dynamic registration at runtime
export function registerAction(name: string, handler: ActionHandler) {
    registry[name] = handler
}

export function listActions() { return Object.keys(registry) }

import React from 'react'

interface ActionBarProps {
    onTakeControl: () => void
    onCorrectAI: () => void
    onAddNote: () => void
    onMarkCritical: () => void
    onForwardSpecialist: () => void
    onValidateAI: () => void
}

const ActionBar: React.FC<ActionBarProps> = ({
    onTakeControl,
    onCorrectAI,
    onAddNote,
    onMarkCritical,
    onForwardSpecialist,
    onValidateAI
}) => (
    <div className="flex gap-2 mb-4 flex-wrap">
        <button className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={onTakeControl}>Assumir conversa</button>
        <button className="px-3 py-2 rounded bg-yellow-500 text-white hover:bg-yellow-600" onClick={onCorrectAI}>Corrigir resposta da IA</button>
        <button className="px-3 py-2 rounded bg-gray-600 text-white hover:bg-gray-700" onClick={onAddNote}>Adicionar nota</button>
        <button className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700" onClick={onMarkCritical}>Marcar como crítica</button>
        <button className="px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700" onClick={onForwardSpecialist}>Encaminhar para especialista</button>
        <button className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700" onClick={onValidateAI}>Validar resposta da IA</button>
    </div>
)

export default ActionBar

import React, { useState } from 'react'

interface InterventionModalProps {
    open: boolean
    onClose: () => void
    onSubmit: (data: any) => void
    patientInfo: {
        name: string
        lastVisit: string
        allergies: string[]
        currentMedications: string[]
    }
}

const reasons = [
    "Diagnóstico requer avaliação médica",
    "Informação da IA imprecisa/incorreta",
    "Situação emocional delicada",
    "Sintomas de emergência",
    "Solicitação específica do paciente",
    "Procedimento complexo"
]

const InterventionModal: React.FC<InterventionModalProps> = ({ open, onClose, onSubmit, patientInfo }) => {
    const [pauseDuration, setPauseDuration] = useState(15)
    const [reasonCategory, setReasonCategory] = useState(reasons[0])
    const [errorDescription, setErrorDescription] = useState('')
    const [correctionNotes, setCorrectionNotes] = useState('')
    const [followUpRequired, setFollowUpRequired] = useState(false)
    const [specialtyConsult, setSpecialtyConsult] = useState('')

    if (!open) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg">
                <h2 className="text-xl font-bold mb-2">Intervenção Humana</h2>
                <div className="mb-2 text-sm text-gray-700">Paciente: <b>{patientInfo.name}</b> | Última visita: {patientInfo.lastVisit}</div>
                <div className="mb-2 text-xs text-gray-600">Alergias: {patientInfo.allergies.join(', ') || 'Nenhuma'} | Medicações: {patientInfo.currentMedications.join(', ') || 'Nenhuma'}</div>
                <form onSubmit={e => { e.preventDefault(); onSubmit({ pauseDuration, reasonCategory, errorDescription, correctionNotes, followUpRequired, specialtyConsult }) }}>
                    <div className="mb-2">
                        <label className="block text-sm font-medium">Tempo de pausa:</label>
                        <select value={pauseDuration} onChange={e => setPauseDuration(Number(e.target.value))} className="w-full border rounded px-2 py-1">
                            {[5, 15, 30, 60, 120].map(v => <option key={v} value={v}>{v} min</option>)}
                        </select>
                    </div>
                    <div className="mb-2">
                        <label className="block text-sm font-medium">Motivo:</label>
                        <select value={reasonCategory} onChange={e => setReasonCategory(e.target.value)} className="w-full border rounded px-2 py-1">
                            {reasons.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div className="mb-2">
                        <label className="block text-sm font-medium">Descrição do erro <span className="text-red-500">*</span>:</label>
                        <textarea required value={errorDescription} onChange={e => setErrorDescription(e.target.value)} className="w-full border rounded px-2 py-1" rows={2} />
                    </div>
                    <div className="mb-2">
                        <label className="block text-sm font-medium">Notas de correção:</label>
                        <textarea value={correctionNotes} onChange={e => setCorrectionNotes(e.target.value)} className="w-full border rounded px-2 py-1" rows={2} />
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                        <input type="checkbox" checked={followUpRequired} onChange={e => setFollowUpRequired(e.target.checked)} />
                        <label className="text-sm">Acompanhamento necessário</label>
                    </div>
                    <div className="mb-2">
                        <label className="block text-sm font-medium">Especialidade para consulta:</label>
                        <input type="text" value={specialtyConsult} onChange={e => setSpecialtyConsult(e.target.value)} className="w-full border rounded px-2 py-1" />
                    </div>
                    <div className="flex gap-2 mt-4">
                        <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Enviar intervenção</button>
                        <button type="button" className="px-4 py-2 rounded bg-gray-400 text-white hover:bg-gray-500" onClick={onClose}>Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default InterventionModal

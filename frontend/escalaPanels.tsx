import React from 'react'
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Save,
  Shield,
  X,
} from 'lucide-react'
import { Button } from '@/button'
import { Checkbox } from '@/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/dialog'
import { Input } from '@/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/popover'
import { Progress } from '@/progress'
import { TooltipButton } from '@/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/select'
import {
  EscalaBulkSelectionPanel,
  MultiSelectField,
} from '@/escalaComponents'
import {
  DEFAULT_TEAM_COLOR,
  formatMonthLabel,
  getProfessionalBadgeStyle,
  normalizeHexColor,
  parseDelimitedValues,
  ROLE_OPTIONS,
  slugifySegment,
  STATUS_OPTIONS,
  UNIT_OPTIONS,
} from '@/escalaShared'
import type {
  EscalaProfessional,
  EscalaScheduleEntry,
  EscalaTeamFormMode,
} from '@/escalaTypes'
import { cn } from '@/utils'

type EscalaTeamPanelProps = {
  activeInjectors: EscalaProfessional[]
  inactiveInjectors: EscalaProfessional[]
  isBulkSelectionMode: boolean
  savingTeamMember: boolean
  selectedTeamMember: string
  selectedTeamMemberDirty: boolean
  selectedTeamMemberDraft: EscalaProfessional | null
  showInactiveTeamMembers: boolean
  teamFormMode: EscalaTeamFormMode
  teamLoadError: string | null
  onBeginAddTeamMember: () => void
  onBeginEditTeamMember: (name?: string) => void
  onCancelBulkSelectionMode: () => void
  onCloseTeamPanel: () => void
  onConfirmBulkSelectionMode: () => void
  onEnableBulkSelectionMode: () => void
  onRetryProfessionals: () => void
  onSaveTeamMember: () => void
  onSelectTeamMember: (name: string) => void
  onToggleInactiveTeamMembers: () => void
  onToggleSelectedTeamMemberOption: (field: 'units' | 'role', option: string) => void
  onUpdateSelectedTeamMemberField: (field: keyof EscalaProfessional, value: string) => void
}

type EscalaAssignDialogProps = {
  activeDate: string | null
  assignableProfessionalOptions: string[]
  closedBlockedDates: Set<string>
  closedDateSet: Set<string>
  closedReasonByDate: Map<string, string>
  dayActionKey: string | null
  dayBlockReasons: Record<string, string>
  getDatesSelectionState: (dates: string[], name: string) => boolean | 'indeterminate'
  getDayDraft: (date: string, entries: EscalaScheduleEntry[]) => string[]
  isBulkAssignModalOpen: boolean
  isBulkSelectionMode: boolean
  isDayAssignModalOpen: boolean
  multiDateBlockReason: string
  professionalMap: Map<string, EscalaProfessional>
  scheduleByDate: Map<string, EscalaScheduleEntry[]>
  selectedDates: string[]
  selectedDatesLabel: string
  setDayBlockReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setIsBulkAssignModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setIsDayAssignModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMultiDateBlockReason: React.Dispatch<React.SetStateAction<string>>
  toggleDayProfessional: (date: string, name: string, entries: EscalaScheduleEntry[]) => void
  toggleSelectedDatesProfessional: (name: string) => void
  onCloseAssignModalWithoutSave: () => void
  onCloseActiveDateWithSave: () => void
  onToggleSelectedDatesBlock: () => void
}

type EscalaPlanningAssistantModalProps = {
  autoPrefillProgress: number
  autoPrefillState: {
    status: string
    message: string
    windowMonths: string[]
    completed: number
    total: number
  }
  onApplySuggestions: () => Promise<unknown>
  onIgnoreSuggestions: () => void
  onOpenChange: (open: boolean) => void
  onRetryAnalysis: () => void
  open: boolean
  planningAssistantProgressLabel: string
  planningAssistantTitle: string
  selectedMonth: string
}

export function EscalaTeamPanel({
  activeInjectors,
  inactiveInjectors,
  isBulkSelectionMode,
  savingTeamMember,
  selectedTeamMember,
  selectedTeamMemberDirty,
  selectedTeamMemberDraft,
  showInactiveTeamMembers,
  teamFormMode,
  teamLoadError,
  onBeginAddTeamMember,
  onBeginEditTeamMember,
  onCancelBulkSelectionMode,
  onCloseTeamPanel,
  onConfirmBulkSelectionMode,
  onEnableBulkSelectionMode,
  onRetryProfessionals,
  onSaveTeamMember,
  onSelectTeamMember,
  onToggleInactiveTeamMembers,
  onToggleSelectedTeamMemberOption,
  onUpdateSelectedTeamMemberField,
}: EscalaTeamPanelProps) {
  const teamPanelExpanded = teamFormMode !== 'idle'

  return (
    <div className="flex flex-col gap-2 xl:w-[360px] xl:justify-self-end">
      <div
        className="escala-team-panel flex flex-col self-start overflow-hidden rounded-2xl border border-white/10 bg-slate-950/45"
        data-testid="escala-team-panel"
      >
        <div className="border-b border-white/10 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-300/60">Equipe</div>
              <div className="mt-1 text-sm font-semibold text-white">Equipe</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TooltipButton label="Adicionar">
                <Button
                  type="button"
                  size="icon"
                  variant={teamFormMode === 'add' ? 'premium' : 'outline'}
                  onClick={onBeginAddTeamMember}
                  disabled={!!teamLoadError}
                  aria-label="Adicionar injetor"
                  data-testid="escala-team-add"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipButton>
              {teamPanelExpanded ? (
                <>
                  <TooltipButton label="Salvar">
                    <Button
                      type="button"
                      size="icon"
                      variant="premium"
                      onClick={() => void onSaveTeamMember()}
                      disabled={!selectedTeamMemberDraft || !selectedTeamMemberDirty || savingTeamMember || !String(selectedTeamMemberDraft.name || '').trim()}
                      aria-label="Salvar cadastro do injetor"
                      data-testid="escala-team-save"
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </TooltipButton>
                  <TooltipButton label="Fechar">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={onCloseTeamPanel}
                      aria-label="Fechar cadastro da equipe"
                      data-testid="escala-team-close"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipButton>
                </>
              ) : (
                <TooltipButton label="Editar">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => onBeginEditTeamMember(selectedTeamMember)}
                    disabled={!selectedTeamMember || !!teamLoadError}
                    aria-label="Editar injetor"
                    data-testid="escala-team-edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipButton>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {teamLoadError ? (
              <div
                className="w-full rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-50/90"
                data-testid="escala-team-error"
              >
                <div className="font-medium text-amber-50">Falha ao carregar a equipe do cadastro.</div>
                <div className="mt-1 text-amber-50/80">
                  A agenda pode continuar visível, mas a lateral da equipe não está confiável até recarregar os profissionais.
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 border-amber-200/35 bg-amber-50/8 text-amber-50 hover:bg-amber-50/14"
                  onClick={() => void onRetryProfessionals()}
                  data-testid="escala-team-retry"
                >
                  Tentar novamente
                </Button>
              </div>
            ) : activeInjectors.length || inactiveInjectors.length ? (
              <>
                {activeInjectors.map((prof) => {
                  const isCurrent = prof.name === selectedTeamMember
                  return (
                    <button
                      key={prof.name}
                      type="button"
                      className={cn(
                        'min-h-[30px] rounded-full border px-2.5 py-1 text-[10px] font-medium leading-tight transition-all',
                        isCurrent ? 'text-white shadow-[0_14px_26px_rgba(15,23,42,0.24)]' : 'text-slate-200/80 hover:text-white',
                      )}
                      style={getProfessionalBadgeStyle(prof.name, isCurrent ? 'active' : 'default', prof.color)}
                      onClick={() => onSelectTeamMember(prof.name)}
                      data-testid={`escala-team-member-${slugifySegment(prof.name)}`}
                    >
                      {prof.name}
                    </button>
                  )
                })}
                {inactiveInjectors.length ? (
                  <>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium leading-tight transition-all',
                        showInactiveTeamMembers ? 'text-white' : 'text-rose-100/90 hover:text-white',
                      )}
                      style={{
                        background: showInactiveTeamMembers
                          ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.38), rgba(190, 24, 93, 0.28))'
                          : 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(190, 24, 93, 0.16))',
                        borderColor: showInactiveTeamMembers ? 'rgba(254, 202, 202, 0.85)' : 'rgba(252, 165, 165, 0.45)',
                        boxShadow: showInactiveTeamMembers
                          ? '0 14px 26px rgba(69, 10, 10, 0.26), inset 0 1px 0 rgba(255,255,255,0.16)'
                          : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                      }}
                      onClick={onToggleInactiveTeamMembers}
                      data-testid="escala-team-inactive-toggle"
                      aria-expanded={showInactiveTeamMembers}
                    >
                      <span>{`Inativos (${inactiveInjectors.length})`}</span>
                      {showInactiveTeamMembers ? (
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {showInactiveTeamMembers ? inactiveInjectors.map((prof) => {
                      const isCurrent = prof.name === selectedTeamMember
                      return (
                        <button
                          key={prof.name}
                          type="button"
                          className={cn(
                            'min-h-[30px] rounded-full border px-2.5 py-1 text-[10px] font-medium leading-tight transition-all',
                            isCurrent ? 'text-white shadow-[0_14px_26px_rgba(69,10,10,0.28)]' : 'text-rose-100/90 hover:text-white',
                          )}
                          style={{
                            background: isCurrent
                              ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.42), rgba(190, 24, 93, 0.3))'
                              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(190, 24, 93, 0.16))',
                            borderColor: isCurrent ? 'rgba(254, 202, 202, 0.9)' : 'rgba(252, 165, 165, 0.45)',
                            boxShadow: isCurrent
                              ? '0 14px 26px rgba(69,10,10,0.3), inset 0 1px 0 rgba(255,255,255,0.18)'
                              : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                          }}
                          onClick={() => onSelectTeamMember(prof.name)}
                          data-testid={`escala-team-member-${slugifySegment(prof.name)}`}
                        >
                          {prof.name}
                        </button>
                      )
                    }) : null}
                  </>
                ) : null}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-slate-300/70">
                Nenhum injetor encontrado para a unidade selecionada.
              </div>
            )}
          </div>
        </div>

        {teamPanelExpanded ? (
          <div className="px-3 py-3">
            {selectedTeamMemberDraft ? (
              <div className="grid content-start gap-2.5 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/65">NOME</span>
                  <Input
                    value={selectedTeamMemberDraft.name}
                    onChange={(event) => onUpdateSelectedTeamMemberField('name', event.target.value)}
                    className="h-9 border-white/10 bg-white/[0.05] text-sm text-white placeholder:text-slate-500"
                    data-testid="escala-team-field-name"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/65">SITUAÇÃO</span>
                  <Select
                    value={selectedTeamMemberDraft.status || STATUS_OPTIONS[0]}
                    onValueChange={(value) => onUpdateSelectedTeamMemberField('status', value)}
                  >
                    <SelectTrigger className="h-9 w-full border-white/10 bg-white/[0.05] text-white" data-testid="escala-team-field-status">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent className="border-white/15 bg-slate-900 text-slate-100">
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <MultiSelectField
                  label="CARGO"
                  placeholder="Selecione os cargos"
                  options={ROLE_OPTIONS}
                  values={parseDelimitedValues(selectedTeamMemberDraft.role)}
                  onToggle={(option) => onToggleSelectedTeamMemberOption('role', option)}
                  testId="escala-team-field-role"
                />

                <MultiSelectField
                  label="UNIDADE"
                  placeholder="Selecione as unidades"
                  options={UNIT_OPTIONS}
                  values={selectedTeamMemberDraft.units}
                  onToggle={(option) => onToggleSelectedTeamMemberOption('units', option)}
                  testId="escala-team-field-units"
                />

                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/65">EMAIL</span>
                  <Input
                    value={selectedTeamMemberDraft.email}
                    onChange={(event) => onUpdateSelectedTeamMemberField('email', event.target.value)}
                    className="h-9 border-white/10 bg-white/[0.05] text-sm text-white placeholder:text-slate-500"
                    data-testid="escala-team-field-email"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/65">TELEFONE</span>
                  <Input
                    value={selectedTeamMemberDraft.phone}
                    onChange={(event) => onUpdateSelectedTeamMemberField('phone', event.target.value)}
                    placeholder="+55 (51) 99999-9999"
                    className="h-9 border-white/10 bg-white/[0.05] text-sm text-white placeholder:text-slate-500"
                    data-testid="escala-team-field-phone"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/65">INSTAGRAM</span>
                  <Input
                    value={selectedTeamMemberDraft.instagram}
                    onChange={(event) => onUpdateSelectedTeamMemberField('instagram', event.target.value)}
                    className="h-9 border-white/10 bg-white/[0.05] text-sm text-white placeholder:text-slate-500"
                    data-testid="escala-team-field-instagram"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300/65">COR</span>
                  <div className="flex h-9 items-center gap-3 rounded-md border border-white/10 bg-white/[0.05] px-3">
                    <input
                      type="color"
                      value={normalizeHexColor(selectedTeamMemberDraft.color) || DEFAULT_TEAM_COLOR}
                      onChange={(event) => onUpdateSelectedTeamMemberField('color', event.target.value)}
                      className="h-6 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                      data-testid="escala-team-field-color"
                      aria-label="Escolher cor do injetor"
                    />
                    <div
                      className="h-[18px] w-[18px] rounded-full border border-white/20"
                      style={{ background: normalizeHexColor(selectedTeamMemberDraft.color) || DEFAULT_TEAM_COLOR }}
                      aria-hidden="true"
                    />
                    <span className="text-xs text-slate-300/75">
                      {normalizeHexColor(selectedTeamMemberDraft.color) || DEFAULT_TEAM_COLOR}
                    </span>
                  </div>
                </label>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-300/70">
                {selectedTeamMember
                  ? 'Clique em Editar para abrir os campos do injetor selecionado.'
                  : 'Selecione um injetor e clique em Editar para abrir os campos.'}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <EscalaBulkSelectionPanel
        isBulkSelectionMode={isBulkSelectionMode}
        onEnable={onEnableBulkSelectionMode}
        onConfirm={onConfirmBulkSelectionMode}
        onCancel={onCancelBulkSelectionMode}
      />
    </div>
  )
}

export function EscalaAssignDialog({
  activeDate,
  assignableProfessionalOptions,
  closedBlockedDates,
  closedDateSet,
  closedReasonByDate,
  dayActionKey,
  dayBlockReasons,
  getDatesSelectionState,
  getDayDraft,
  isBulkAssignModalOpen,
  isBulkSelectionMode,
  isDayAssignModalOpen,
  multiDateBlockReason,
  professionalMap,
  scheduleByDate,
  selectedDates,
  selectedDatesLabel,
  setDayBlockReasons,
  setIsBulkAssignModalOpen,
  setIsDayAssignModalOpen,
  setMultiDateBlockReason,
  toggleDayProfessional,
  toggleSelectedDatesProfessional,
  onCloseAssignModalWithoutSave,
  onCloseActiveDateWithSave,
  onToggleSelectedDatesBlock,
}: EscalaAssignDialogProps) {
  const isOpen = isBulkSelectionMode
    ? (isBulkAssignModalOpen && selectedDates.length > 0)
    : (isDayAssignModalOpen && selectedDates.length > 0)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          if (isBulkSelectionMode) {
            setIsBulkAssignModalOpen(true)
          } else {
            setIsDayAssignModalOpen(true)
          }
          return
        }
        onCloseAssignModalWithoutSave()
      }}
    >
      <DialogContent
        className="max-w-sm border-white/10 bg-slate-950/96 text-slate-100"
        data-escala-preserve-filter="true"
        data-escala-bulk-preserve="true"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onCloseAssignModalWithoutSave()
        }}
      >
        <button
          type="button"
          className="absolute right-10 top-3 rounded-xs border border-emerald-300/35 bg-emerald-500/16 px-2 py-1 text-[11px] font-semibold text-emerald-50 transition hover:bg-emerald-500/24 focus:outline-none focus:ring-2 focus:ring-emerald-300/45 sm:right-11 sm:top-4"
          onClick={() => void onCloseActiveDateWithSave()}
          data-testid="escala-modal-confirm"
          aria-label="Confirmar alterações"
        >
          V
        </button>
        {selectedDates.length ? (
          <>
            <DialogHeader className="space-y-1">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base">
                    {selectedDates.length === 1 ? 'Injetores do dia' : 'Injetores das datas'}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-300/75">
                    {selectedDates.length === 1 ? selectedDatesLabel : `${selectedDates.length} datas selecionadas`}
                  </DialogDescription>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid={selectedDates.length === 1 && activeDate ? `escala-block-${activeDate}` : 'escala-block-multi'}
                      className={cn(
                        'escala-card-action rounded-full border p-2 hover:bg-white/[0.12]',
                        selectedDates.every((date) => closedBlockedDates.has(date))
                          ? 'border-rose-300/40 bg-rose-500/15 text-rose-100'
                          : 'border-white/15 bg-white/[0.06] text-white/85',
                      )}
                      aria-label={selectedDates.length === 1 && activeDate ? `Bloquear data ${activeDate}` : 'Bloquear datas selecionadas'}
                    >
                      <Shield className="size-4.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-72 border-white/15 bg-slate-900/95 text-slate-100"
                    align="end"
                    data-escala-preserve-filter="true"
                  >
                    <div className="space-y-3 text-xs">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">
                          {selectedDates.length === 1 ? 'Bloqueio de data' : 'Bloqueio de datas'}
                        </div>
                        <div className="text-sm text-white">
                          {selectedDates.length === 1 ? activeDate : selectedDatesLabel}
                        </div>
                      </div>
                      <Input
                        value={
                          selectedDates.length === 1 && activeDate
                            ? (dayBlockReasons[activeDate] || closedReasonByDate.get(activeDate) || '')
                            : multiDateBlockReason
                        }
                        onChange={(event) => {
                          if (selectedDates.length === 1 && activeDate) {
                            setDayBlockReasons((prev) => ({ ...prev, [activeDate]: event.target.value }))
                            return
                          }
                          setMultiDateBlockReason(event.target.value)
                        }}
                        placeholder="escreva o motivo"
                        className="h-9 bg-white/5"
                        data-testid={selectedDates.length === 1 && activeDate ? `escala-block-reason-${activeDate}` : 'escala-block-reason-multi'}
                        disabled={selectedDates.length === 1 && !!activeDate && closedBlockedDates.has(activeDate) && !closedDateSet.has(activeDate)}
                      />
                      <Button
                        variant={selectedDates.every((date) => closedDateSet.has(date)) ? 'outline' : 'premium'}
                        size="sm"
                        className="w-full"
                        data-testid={selectedDates.length === 1 && activeDate ? `escala-toggle-block-${activeDate}` : 'escala-toggle-block-multi'}
                        onClick={() => void onToggleSelectedDatesBlock()}
                        disabled={dayActionKey === (selectedDates.length === 1 && activeDate ? `block:${activeDate}` : 'block:multi')}
                      >
                        {selectedDates.every((date) => closedDateSet.has(date))
                          ? (selectedDates.length === 1 ? 'Remover bloqueio' : 'Remover bloqueio das datas')
                          : (selectedDates.length === 1 ? 'Bloquear data' : 'Bloquear datas')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </DialogHeader>

            {selectedDates.length > 1 ? (
              <div className="rounded-xl border border-sky-300/16 bg-sky-400/8 px-3 py-2 text-[11px] text-sky-100/78">
                Seleção múltipla ativa. As alterações de injetores e bloqueio serão aplicadas em todas as datas selecionadas.
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              {assignableProfessionalOptions.length ? assignableProfessionalOptions.map((name) => {
                const targetDates = selectedDates.filter((date) => !closedBlockedDates.has(date))
                const checked = selectedDates.length === 1 && activeDate
                  ? (
                    closedBlockedDates.has(activeDate)
                      ? false
                      : getDayDraft(activeDate, scheduleByDate.get(activeDate) || []).includes(name)
                  )
                  : getDatesSelectionState(targetDates, name)
                return (
                  <label
                    key={`${selectedDates.join('|')}-${name}`}
                    className={cn(
                      'flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-xs transition-all',
                      checked ? 'shadow-[0_10px_24px_rgba(15,23,42,0.18)]' : 'bg-white/[0.03]',
                    )}
                    style={getProfessionalBadgeStyle(name, checked ? 'active' : 'default', professionalMap.get(name)?.color)}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => {
                        if (selectedDates.length === 1 && activeDate) {
                          toggleDayProfessional(activeDate, name, scheduleByDate.get(activeDate) || [])
                          return
                        }
                        toggleSelectedDatesProfessional(name)
                      }}
                      disabled={selectedDates.length === 1 && !!activeDate ? closedBlockedDates.has(activeDate) : selectedDates.every((date) => closedBlockedDates.has(date))}
                    />
                    <span className="truncate font-medium">{name}</span>
                  </label>
                )
              }) : (
                <div className="col-span-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300/80">
                  Nenhum injetor ativo disponível.
                </div>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function EscalaPlanningAssistantModal({
  autoPrefillProgress,
  autoPrefillState,
  onApplySuggestions,
  onIgnoreSuggestions,
  onOpenChange,
  onRetryAnalysis,
  open,
  planningAssistantProgressLabel,
  planningAssistantTitle,
  selectedMonth,
}: EscalaPlanningAssistantModalProps) {
  const prefillWindowLabel = autoPrefillState.windowMonths.map(formatMonthLabel).join(', ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-white/14 bg-[#121a2d]/96 text-white shadow-2xl shadow-slate-950/60 backdrop-blur-xl sm:max-w-lg"
        data-testid="escala-planning-assistant-modal"
      >
        <div
          data-testid="escala-autoprefill-status"
          className={cn(
            'rounded-2xl border px-4 py-4',
            autoPrefillState.status === 'error'
              ? 'border-rose-300/35 bg-rose-500/10'
              : autoPrefillState.status === 'done'
                ? 'border-emerald-300/28 bg-emerald-500/10'
                : autoPrefillState.status === 'ignored'
                  ? 'border-slate-300/20 bg-white/[0.04]'
                  : 'border-sky-300/25 bg-sky-500/10',
          )}
        >
          <DialogHeader className="space-y-2 text-left">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300/65">
              Assistente de planejamento
            </div>
            <DialogTitle className="text-base text-slate-50">
              {planningAssistantTitle}
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5 text-slate-100/88">
              {autoPrefillState.message}
            </DialogDescription>
          </DialogHeader>

          {prefillWindowLabel ? (
            <div className="mt-3 text-[10px] text-slate-300/72">
              Base histórica: {prefillWindowLabel}
            </div>
          ) : null}

          {autoPrefillState.status !== 'error' ? (
            <div className="mt-4 space-y-1.5">
              <Progress value={autoPrefillProgress} className="h-1.5 bg-white/10 [&_[data-slot=progress-indicator]]:bg-sky-300" />
              <div className="flex items-center justify-between text-[10px] text-slate-300/70">
                <span>{formatMonthLabel(selectedMonth)}</span>
                <span>{planningAssistantProgressLabel}</span>
              </div>
            </div>
          ) : null}

          {(autoPrefillState.status === 'ready' || autoPrefillState.status === 'error') ? (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {autoPrefillState.status === 'ready' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onIgnoreSuggestions}
                    data-testid="escala-prefill-ignore"
                  >
                    Ignorar neste mês
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="premium"
                    onClick={() => void onApplySuggestions()}
                    data-testid="escala-prefill-apply"
                  >
                    Aplicar sugestões
                  </Button>
                </>
              ) : null}
              {autoPrefillState.status === 'error' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRetryAnalysis}
                  data-testid="escala-prefill-retry"
                >
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

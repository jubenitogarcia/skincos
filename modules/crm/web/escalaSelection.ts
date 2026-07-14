export function toggleDateSelection(selectedDates: string[], date: string) {
  const alreadySelected = selectedDates.includes(date)
  const nextDates = alreadySelected
    ? selectedDates.filter((item) => item !== date)
    : Array.from(new Set([...selectedDates, date])).sort()
  return {
    alreadySelected,
    nextDates,
  }
}

export function resolveNextActiveDate(nextDates: string[], date: string, alreadySelected: boolean) {
  if (!nextDates.length) return null
  return alreadySelected ? nextDates[nextDates.length - 1] || null : date
}

export function filterDatesToMonth(selectedDates: string[], monthKey: string) {
  return selectedDates.filter((date) => date.startsWith(`${monthKey}-`))
}

export function buildSelectedDatesLabel(selectedDates: string[], formatDisplayDate: (value: string) => string) {
  if (!selectedDates.length) return ''
  if (selectedDates.length === 1) return formatDisplayDate(selectedDates[0])
  const ordered = [...selectedDates].sort()
  const preview = ordered.slice(0, 3).map(formatDisplayDate)
  const suffix = ordered.length > 3 ? ` +${ordered.length - 3}` : ''
  return `${preview.join(', ')}${suffix}`
}

export function buildSelectionScopeLabel(selectedDatesLabel: string, selectedDatesCount: number) {
  if (!selectedDatesCount) return 'Nenhuma data selecionada'
  return selectedDatesCount === 1
    ? `1 data selecionada: ${selectedDatesLabel}`
    : `${selectedDatesCount} datas selecionadas: ${selectedDatesLabel}`
}

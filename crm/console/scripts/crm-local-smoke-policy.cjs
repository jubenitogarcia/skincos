function isOptionalLocalDependencyError(moduleKey, entry) {
  if (moduleKey !== 'faturamento' || Number(entry?.status) !== 500) return false
  let pathname = ''
  try {
    pathname = new URL(String(entry?.url || '')).pathname
  } catch {
    return false
  }
  return pathname === '/api/atendimento/management/charts' &&
    /"error"\s*:\s*"No key or keyFile set\."/i.test(String(entry?.body || ''))
}

function partitionModuleErrors(moduleKey, apiEntries = [], consoleEntries = []) {
  const apiWarnings = apiEntries.filter((entry) => isOptionalLocalDependencyError(moduleKey, entry))
  const apiErrors = apiEntries.filter((entry) => !isOptionalLocalDependencyError(moduleKey, entry))
  let genericConsoleAllowance = apiWarnings.length
  const consoleErrors = []
  const consoleWarnings = []
  for (const entry of consoleEntries) {
    if (genericConsoleAllowance > 0 && /Failed to load resource:.*status of 500/i.test(String(entry || ''))) {
      consoleWarnings.push(entry)
      genericConsoleAllowance -= 1
    } else {
      consoleErrors.push(entry)
    }
  }
  return { apiErrors, apiWarnings, consoleErrors, consoleWarnings }
}

module.exports = { isOptionalLocalDependencyError, partitionModuleErrors }

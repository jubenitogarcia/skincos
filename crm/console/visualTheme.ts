export function getCssVarValue(variableName: string, fallback = ""): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback
  }

  const node = document.documentElement
  const rawValue = window.getComputedStyle(node).getPropertyValue(variableName)
  const value = String(rawValue || "").trim()
  return value || fallback
}

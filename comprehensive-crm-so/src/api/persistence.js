import { promises as fs } from 'fs'
import path from 'path'

async function ensureDir(filePath) {
    try { await fs.mkdir(path.dirname(filePath), { recursive: true }) } catch { }
}

export async function loadJson(filePath, defaultValue) {
    try { const raw = await fs.readFile(filePath, 'utf-8'); return JSON.parse(raw) } catch { return defaultValue }
}

export async function saveJson(filePath, data) {
    await ensureDir(filePath)
    const tmp = filePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data, null, 2))
    await fs.rename(tmp, filePath)
}

export function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

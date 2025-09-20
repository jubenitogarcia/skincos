'use strict'

const fs = require('fs')
const path = require('path')

function parseIntOr(val, fallback) {
    const n = parseInt(val, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
}

function extractSuggestions(body) {
    if (typeof body !== 'string') return []
    const re = /```suggestion[\s\S]*?\n([\s\S]*?)```/g
    const out = []
    let m
    while ((m = re.exec(body)) !== null) out.push(m[1].replace(/\n$/, ''))
    return out
}

function applyEditsToFile(filePath, edits) {
    if (!fs.existsSync(filePath)) return 0
    let text = fs.readFileSync(filePath, 'utf8')
    const lines = text.split(/\r?\n/)
    // Sort from bottom to top
    edits.sort((a, b) => b.start - a.start)
    let changed = 0
    for (const e of edits) {
        const sIdx = Math.max(0, e.start - 1)
        const eIdx = Math.max(sIdx, e.end - 1)
        const repl = (e.suggestion || '').split(/\r?\n/)
        lines.splice(sIdx, eIdx - sIdx + 1, ...repl)
        changed++
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, lines.join('\n'))
    return changed
}

function main() {
    const commentsPath = process.argv[2] || 'comments.json'
    if (!fs.existsSync(commentsPath)) {
        console.error(`comments file not found: ${commentsPath}`)
        process.exit(0)
    }
    const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8'))
    const withSugg = comments.filter(c => c && typeof c.body === 'string' && c.body.includes('```suggestion'))
    const byFile = new Map()
    for (const c of withSugg) {
        const f = c.path
        if (!f) continue
        const start = parseIntOr(c.original_start_line || c.start_line || c.line, null)
        const end = parseIntOr(c.original_line || c.line || start, start)
        if (start == null) continue
        const suggestion = extractSuggestions(c.body)[0]
        if (!suggestion) continue
        if (!byFile.has(f)) byFile.set(f, [])
        byFile.get(f).push({ start, end, suggestion })
    }
    let total = 0
    for (const [f, edits] of byFile) {
        total += applyEditsToFile(f, edits)
    }
    console.log(`applied_edits=${total}`)
}

if (require.main === module) main()

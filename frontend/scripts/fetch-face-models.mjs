import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_BASE =
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'

const FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
]

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return buf
}

async function main() {
  const base = String(process.env.FACE_MODELS_BASE || DEFAULT_BASE).replace(/\/+$/, '')
  const outDir = path.resolve('frontend/public/face-models')
  await mkdir(outDir, { recursive: true })

  console.log(`Downloading face models from: ${base}`)
  console.log(`Output dir: ${outDir}`)

  for (const file of FILES) {
    const url = `${base}/${file}`
    process.stdout.write(`- ${file}... `)
    const buf = await download(url)
    await writeFile(path.join(outDir, file), buf)
    console.log(`ok (${buf.length} bytes)`)
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})


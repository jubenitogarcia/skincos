import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const defaultBase = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'
const files = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'ssd_mobilenetv1_model-shard2',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
]

async function main() {
  const base = String(process.env.FACE_MODELS_BASE || defaultBase).replace(/\/+$/, '')
  const output = path.resolve('public/face-models')
  await mkdir(output, { recursive: true })
  for (const filename of files) {
    const response = await fetch(`${base}/${filename}`)
    if (!response.ok) throw new Error(`FACE_MODEL_DOWNLOAD_FAILED:${response.status}:${filename}`)
    await writeFile(path.join(output, filename), Buffer.from(await response.arrayBuffer()))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

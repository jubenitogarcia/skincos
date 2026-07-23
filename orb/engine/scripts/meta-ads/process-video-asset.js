#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_DURATION_SECONDS = 60;
const MAX_OUTPUT_BYTES = 90 * 1024 * 1024;
const MIN_WIDTH = 720;
const MIN_HEIGHT = 1280;
const TARGET_RATIO = 9 / 16;
const RATIO_TOLERANCE = 0.025;

function fail(code, detail = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: code, ...detail })}\n`);
  process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

function safeSegment(value, fallback) {
  return String(value || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || fallback;
}

function payload() {
  const encoded = arg('--payload-b64');
  if (!encoded) fail('payload_missing');
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch (error) { fail('payload_invalid'); }
}

function run(command, args, timeout = 600000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) fail(`${command}_failed`, { detail: String(result.error?.message || result.stderr || result.stdout).slice(0, 1000) });
  return String(result.stdout || '');
}

function probe(file) {
  const raw = run('ffprobe', [
    '-v', 'error', '-show_entries',
    'format=duration,size,format_name:stream=codec_type,codec_name,width,height',
    '-of', 'json', file,
  ], 120000);
  let value;
  try { value = JSON.parse(raw); } catch { fail('ffprobe_output_invalid'); }
  const video = (value.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (value.streams || []).find((stream) => stream.codec_type === 'audio');
  if (!video) fail('video_stream_missing');
  return {
    duration_seconds: Number(value.format?.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    video_codec: String(video.codec_name || ''),
    audio_codec: String(audio?.codec_name || ''),
    has_audio: Boolean(audio),
    format_name: String(value.format?.format_name || ''),
    size_bytes: Number(value.format?.size || fs.statSync(file).size),
  };
}

function checksum(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function validateInput(file, mime, info) {
  if (!/\.(mp4|mov)$/i.test(file) && !['video/mp4', 'video/quicktime'].includes(mime)) fail('video_container_not_allowed');
  if (!(info.duration_seconds > 0 && info.duration_seconds <= MAX_DURATION_SECONDS)) fail('video_duration_invalid', { duration_seconds: info.duration_seconds });
  if (info.width < MIN_WIDTH || info.height < MIN_HEIGHT) fail('video_resolution_too_small', { width: info.width, height: info.height });
  const ratio = info.width / info.height;
  if (Math.abs(ratio - TARGET_RATIO) > RATIO_TOLERANCE) fail('video_ratio_not_9x16', { width: info.width, height: info.height, ratio });
}

function extractFrame(video, seconds, file) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', '-vf', 'scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2:black', '-q:v', '2', file]);
}

function main() {
  const input = payload();
  const inputFile = path.resolve(String(input.input_file || ''));
  if (!inputFile || !fs.existsSync(inputFile)) fail('input_file_missing');
  const sourceFileId = safeSegment(input.source_file_id, 'media');
  const executionId = safeSegment(input.execution_id, 'execution');
  const mime = String(input.mime_type || '').toLowerCase();
  const outputDir = path.resolve(String(input.output_dir || path.join(path.dirname(inputFile), `${sourceFileId}_${executionId}`)));
  fs.mkdirSync(outputDir, { recursive: true });

  const inputProbe = probe(inputFile);
  validateInput(inputFile, mime, inputProbe);
  const normalized = path.join(outputDir, `${sourceFileId}.mp4`);
  const videoBitrateKbps = Math.max(1500, Math.min(8000, Math.floor((MAX_OUTPUT_BYTES * 8 * 0.88) / inputProbe.duration_seconds / 1000) - (inputProbe.has_audio ? 128 : 0)));
  const audioArgs = inputProbe.has_audio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', inputFile,
    '-map', '0:v:0', ...(inputProbe.has_audio ? ['-map', '0:a:0?'] : []),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-b:v', `${videoBitrateKbps}k`, '-maxrate', `${Math.ceil(videoBitrateKbps * 1.1)}k`, '-bufsize', `${videoBitrateKbps * 2}k`,
    ...audioArgs, '-movflags', '+faststart', normalized,
  ]);
  const outputBytes = fs.statSync(normalized).size;
  if (outputBytes > MAX_OUTPUT_BYTES) fail('normalized_video_too_large', { output_bytes: outputBytes });
  const normalizedProbe = probe(normalized);

  const percentages = [0.10, 0.35, 0.60, 0.85];
  const frames = percentages.map((percentage, index) => {
    const seconds = Math.max(0.1, Math.min(normalizedProbe.duration_seconds - 0.1, normalizedProbe.duration_seconds * percentage));
    const file = path.join(outputDir, `${sourceFileId}_frame_${index + 1}.jpg`);
    extractFrame(normalized, seconds, file);
    return { file, seconds, percentage };
  });
  const thumbnail = path.join(outputDir, `${sourceFileId}_thumbnail.jpg`);
  fs.copyFileSync(frames[1].file, thumbnail);
  const contactSheet = path.join(outputDir, `${sourceFileId}_contact_sheet.jpg`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...frames.flatMap((frame) => ['-i', frame.file]),
    '-filter_complex', '[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[out]',
    '-map', '[out]', '-frames:v', '1', '-q:v', '2', contactSheet,
  ]);
  let audioFile = '';
  if (normalizedProbe.has_audio) {
    audioFile = path.join(outputDir, `${sourceFileId}_audio.wav`);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', normalized, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioFile]);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    source_file_id: String(input.source_file_id || ''),
    media_type: 'video',
    mime_type: 'video/mp4',
    normalized_file: normalized,
    thumbnail_file: thumbnail,
    contact_sheet_file: contactSheet,
    audio_file: audioFile,
    duration_seconds: normalizedProbe.duration_seconds,
    width: normalizedProbe.width,
    height: normalizedProbe.height,
    has_audio: normalizedProbe.has_audio,
    source_bytes: inputProbe.size_bytes,
    output_bytes: outputBytes,
    source_checksum_sha256: checksum(inputFile),
    output_checksum_sha256: checksum(normalized),
    thumbnail_checksum_sha256: checksum(thumbnail),
    frame_evidence: frames.map(({ seconds, percentage }) => ({ seconds, percentage })),
    limits: { max_duration_seconds: MAX_DURATION_SECONDS, max_output_bytes: MAX_OUTPUT_BYTES, min_width: MIN_WIDTH, min_height: MIN_HEIGHT },
  }));
}

main();

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SIMPLE_UPLOAD_LIMIT_BYTES = 100_000_000;
const SAFE_UPLOAD_BYTES = 90_000_000;
const VIDEO_OPTIMIZE_TRIGGER_BYTES = 85_000_000;
const IMAGE_OPTIMIZE_TRIGGER_BYTES = 8_000_000;
const AUDIO_BITRATE_KBPS = 128;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parsePayload() {
  const rawB64 = argValue('--payload-b64') || process.env.LIVIA_PROCESS_MEDIA_PAYLOAD_B64 || '';
  const raw = rawB64
    ? Buffer.from(rawB64, 'base64').toString('utf8')
    : (argValue('--payload') || process.env.LIVIA_PROCESS_MEDIA_PAYLOAD || '');
  if (!raw.trim()) fail('Missing --payload for Livia process-media-asset.');
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Invalid process-media-asset payload: ${error.message}`);
  }
}

function str(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function num(value, fallback = 0) {
  const current = Number(value);
  return Number.isFinite(current) ? current : fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 120000,
  });
  if (result.error) {
    return { ok: false, stdout: '', stderr: result.error.message, status: 1 };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status === null ? 1 : result.status,
  };
}

function fileNameOnly(value) {
  return str(value).split('/').filter(Boolean).pop() || '';
}

function withoutExt(value) {
  return str(value).replace(/\.[^/.]+$/, '');
}

function safeSegment(value, fallback = 'run') {
  const cleaned = str(value, '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function detectKind(payload) {
  const mime = str(payload.mimeType).toLowerCase();
  const name = str(payload.name).toLowerCase();
  const isVideo = mime.includes('video') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name);
  const isImage = mime.includes('image/') || /\.(jpg|jpeg|webp|gif|heic|heif|tif|tiff|bmp|png)$/i.test(name);
  return { mime, name, isVideo, isImage };
}

function safeExt(name, mime, isVideo) {
  const fromName = fileNameOnly(name).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const allowed = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'jpg', 'jpeg', 'png', 'webp', 'heic']);
  if (allowed.has(fromName)) return `.${fromName}`;
  if (isVideo) return '.mp4';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  return '.jpg';
}

function fileBytes(filePath) {
  return fs.statSync(filePath).size;
}

function probeMedia(filePath) {
  const result = run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,bit_rate',
    '-of',
    'json',
    filePath,
  ]);
  if (!result.ok) return { ok: false, duration: 0, width: 0, height: 0, error: result.stderr || result.stdout };
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    const video = (parsed.streams || []).find((stream) => stream.codec_type === 'video') || {};
    const duration = num(parsed.format?.duration, 0);
    return {
      ok: duration > 0,
      duration,
      width: num(video.width, 0),
      height: num(video.height, 0),
      videoCodec: str(video.codec_name),
      videoBitrate: num(video.bit_rate, 0),
      size: num(parsed.format?.size, 0),
      error: '',
    };
  } catch (error) {
    return { ok: false, duration: 0, width: 0, height: 0, error: error.message };
  }
}

function candidateTimes(duration) {
  if (!duration || duration <= 0) return [1];
  const raw = [
    1,
    Math.max(0.5, duration * 0.15),
    Math.max(0.5, duration * 0.35),
    Math.max(0.5, duration * 0.55),
  ].filter((value) => value < Math.max(1, duration - 0.2));
  const out = [];
  for (const value of raw) {
    const rounded = Math.round(value * 1000) / 1000;
    if (!out.some((entry) => Math.abs(entry - rounded) < 0.35)) out.push(rounded);
  }
  return out.length ? out.slice(0, 4) : [0.5];
}

function timestamp(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const secs = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

function extractFrame(inputFile, seconds, outputFile) {
  const result = run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(seconds),
    '-i',
    inputFile,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    '-vf',
    'scale=-2:1080',
    outputFile,
  ]);
  return result.ok && fs.existsSync(outputFile);
}

function copyFilePortable(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, fs.readFileSync(source));
}

function targetVideoBitrateKbps(duration, ceilingKbps) {
  const totalBudgetKbps = Math.floor((SAFE_UPLOAD_BYTES * 8 * 0.94) / Math.max(duration, 1) / 1000);
  return Math.max(500, Math.min(ceilingKbps, totalBudgetKbps - AUDIO_BITRATE_KBPS - 120));
}

function transcodeVideo(inputFile, outputFile, duration, profile) {
  const bitrateKbps = targetVideoBitrateKbps(duration, profile.maxVideoKbps);
  const result = run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputFile,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    `scale=-2:min(${profile.maxHeight}\\,ih)`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    `${bitrateKbps}k`,
    '-maxrate',
    `${Math.ceil(bitrateKbps * 1.15)}k`,
    '-bufsize',
    `${Math.ceil(bitrateKbps * 2)}k`,
    '-c:a',
    'aac',
    '-b:a',
    `${AUDIO_BITRATE_KBPS}k`,
    '-movflags',
    '+faststart',
    outputFile,
  ], { timeout: 600000 });
  return { ...result, bitrateKbps };
}

function optimizeImage(inputFile, outputFile) {
  return run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputFile,
    '-vf',
    'scale=1440:-2',
    '-q:v',
    '4',
    outputFile,
  ], { timeout: 300000 });
}

function blockedResult(inputFile, kind, sourceBytes, probe, warnings, blockReason) {
  return {
    status: 'blocked',
    optimized: false,
    mainMediaFilePath: inputFile,
    mimeType: kind.isVideo ? 'video/mp4' : kind.mime,
    sourceBytes,
    outputBytes: sourceBytes,
    uploadEligible: false,
    optimizationProfile: 'blocked',
    blockReason,
    probe,
    warnings,
  };
}

function optimizeIfNeeded(payload, paths, kind, warnings) {
  const sourceBytes = fileBytes(paths.inputFile);
  const isPng = kind.mime.includes('image/png') || /\.png$/i.test(kind.name);
  const videoNeedsOptimization = kind.isVideo && sourceBytes > VIDEO_OPTIMIZE_TRIGGER_BYTES;
  const imageNeedsOptimization = kind.isImage && !kind.isVideo && (isPng || sourceBytes > IMAGE_OPTIMIZE_TRIGGER_BYTES);

  if (!videoNeedsOptimization && !imageNeedsOptimization) {
    return {
      status: 'ok',
      optimized: false,
      mainMediaFilePath: paths.inputFile,
      mimeType: kind.mime,
      sourceBytes,
      outputBytes: sourceBytes,
      uploadEligible: sourceBytes <= SAFE_UPLOAD_BYTES,
      optimizationProfile: 'source_accepted',
      blockReason: sourceBytes > SAFE_UPLOAD_BYTES ? 'source_exceeds_safe_upload_limit' : '',
      probe: null,
      warnings,
    };
  }

  if (kind.isVideo) {
    const sourceProbe = probeMedia(paths.inputFile);
    if (!sourceProbe.ok) {
      warnings.push(`optimization_probe_failed:${sourceProbe.error || 'unknown'}`);
      return blockedResult(
        paths.inputFile,
        kind,
        sourceBytes,
        sourceProbe,
        warnings,
        'video_probe_failed_before_optimization',
      );
    }

    const profiles = [
      { name: 'video_h264_1080p', maxHeight: 1080, maxVideoKbps: 8000 },
      { name: 'video_h264_720p_fallback', maxHeight: 720, maxVideoKbps: 5000 },
    ];
    for (const profile of profiles) {
      const outputFile = path.join(paths.assetDir, `${paths.baseName}_${profile.name}.mp4`);
      const result = transcodeVideo(paths.inputFile, outputFile, sourceProbe.duration, profile);
      if (!result.ok || !fs.existsSync(outputFile)) {
        warnings.push(`optimization_failed:${profile.name}:${result.stderr || result.stdout || result.status}`);
        continue;
      }
      const outputBytes = fileBytes(outputFile);
      if (outputBytes <= SAFE_UPLOAD_BYTES) {
        return {
          status: 'ok',
          optimized: true,
          mainMediaFilePath: outputFile,
          mimeType: 'video/mp4',
          sourceBytes,
          outputBytes,
          uploadEligible: true,
          optimizationProfile: `${profile.name}_${result.bitrateKbps}k`,
          blockReason: '',
          probe: sourceProbe,
          warnings,
        };
      }
      warnings.push(`optimization_output_exceeds_safe_limit:${profile.name}:${outputBytes}`);
    }

    return blockedResult(
      paths.inputFile,
      kind,
      sourceBytes,
      sourceProbe,
      warnings,
      'video_exceeds_safe_upload_limit_after_optimization',
    );
  }

  const result = optimizeImage(paths.inputFile, paths.optimizedPath);
  if (!result.ok || !fs.existsSync(paths.optimizedPath)) {
    warnings.push(`optimization_failed:image_jpeg_1440:${result.stderr || result.stdout || result.status}`);
    return blockedResult(
      paths.inputFile,
      kind,
      sourceBytes,
      null,
      warnings,
      'image_optimization_failed',
    );
  }
  const outputBytes = fileBytes(paths.optimizedPath);
  if (outputBytes > SAFE_UPLOAD_BYTES) {
    warnings.push(`optimization_output_exceeds_safe_limit:image_jpeg_1440:${outputBytes}`);
    return blockedResult(
      paths.inputFile,
      kind,
      sourceBytes,
      null,
      warnings,
      'image_exceeds_safe_upload_limit_after_optimization',
    );
  }
  return {
    status: 'ok',
    optimized: true,
    mainMediaFilePath: paths.optimizedPath,
    mimeType: 'image/jpeg',
    sourceBytes,
    outputBytes,
    uploadEligible: true,
    optimizationProfile: 'image_jpeg_1440',
    blockReason: '',
    probe: null,
    warnings,
  };
}

function analyzeVideo(inputFile, paths, warnings) {
  const duration = probeMedia(inputFile).duration;
  const times = candidateTimes(duration);
  const candidateThumbs = [];

  fs.mkdirSync(path.dirname(paths.thumbPath), { recursive: true });

  for (const [index, seconds] of times.entries()) {
    const rank = index + 1;
    const outputPath = `${paths.baseNoExt}_cand_${String(rank).padStart(2, '0')}.jpg`;
    if (!extractFrame(inputFile, seconds, outputPath)) {
      warnings.push(`frame_extract_failed:${timestamp(seconds)}`);
      continue;
    }
    candidateThumbs.push({
      path: outputPath,
      thumbPath: outputPath,
      rank,
      timestamp: timestamp(seconds),
      timestampSeconds: seconds,
      confidence: Math.max(0.35, 0.75 - index * 0.08),
      reason: index === 0 ? 'frame tecnico inicial' : 'frame tecnico alternativo',
    });
  }

  if (!candidateThumbs.length) {
    throw new Error(`Process Media Asset could not extract any frame from ${inputFile}`);
  }

  copyFilePortable(candidateThumbs[0].path, paths.thumbPath);
  return {
    applicable: true,
    bestTimestamp: candidateThumbs[0].timestamp,
    bestTimestampSeconds: candidateThumbs[0].timestampSeconds,
    bestFrameSeconds: candidateThumbs[0].timestampSeconds,
    reason: candidateThumbs[0].reason,
    confidence: candidateThumbs[0].confidence,
    candidates: candidateThumbs.map(({ timestamp: ts, timestampSeconds, confidence, reason }) => ({
      timestamp: ts,
      timestampSeconds,
      confidence,
      reason,
    })),
    thumbPath: paths.thumbPath,
    candidateThumbs,
  };
}

function main() {
  const payload = parsePayload();
  const inputFile = str(payload.inputFile);
  if (!inputFile) fail('Process Media Asset payload missing inputFile.');
  if (!fs.existsSync(inputFile)) fail(`Process Media Asset input file does not exist: ${inputFile}`);

  const kind = detectKind(payload);
  const dir = path.dirname(inputFile);
  const base = withoutExt(inputFile);
  const baseName = safeSegment(path.basename(base), 'media');
  const runId = safeSegment(payload.executionId || payload.runId || `${Date.now()}_${process.pid}`, 'run');
  const assetDir = path.join(dir, `${baseName}_assets_${runId}`);
  const optimizedExt = kind.isVideo ? '.mp4' : '.jpg';
  fs.mkdirSync(assetDir, { recursive: true });
  const paths = {
    inputFile,
    optimizedPath: path.join(assetDir, `${baseName}_optimized${optimizedExt}`),
    thumbPath: path.join(assetDir, `${baseName}_thumb.jpg`),
    outJson: path.join(assetDir, `${baseName}_frame_analysis.json`),
    baseNoExt: path.join(assetDir, baseName),
    baseName,
    assetDir,
  };
  const warnings = [];
  const optimized = optimizeIfNeeded(payload, paths, kind, warnings);
  let bestFrame = {
    applicable: false,
    bestTimestamp: '',
    bestTimestampSeconds: 0,
    bestFrameSeconds: 0,
    reason: kind.isVideo ? 'not-analyzed' : 'not-video',
    confidence: 0,
    candidates: [],
    thumbPath: '',
  };
  let candidateThumbs = [];

  if (kind.isVideo) {
    const analysisFile = optimized.optimized ? optimized.mainMediaFilePath : inputFile;
    bestFrame = analyzeVideo(analysisFile, paths, warnings);
    candidateThumbs = bestFrame.candidateThumbs;
    fs.writeFileSync(paths.outJson, `${JSON.stringify(bestFrame, null, 2)}\n`);
  }

  const result = {
    status: optimized.status,
    mediaKind: kind.isVideo ? 'video' : 'image',
    sourceFilePath: inputFile,
    sourceFileName: fileNameOnly(inputFile),
    mainMediaFilePath: optimized.mainMediaFilePath || inputFile,
    mainMediaFileName: fileNameOnly(optimized.mainMediaFilePath || inputFile),
    mimeType: optimized.mimeType || kind.mime || (kind.isVideo ? 'video/mp4' : 'image/jpeg'),
    optimized: optimized.optimized,
    sourceBytes: optimized.sourceBytes,
    outputBytes: optimized.outputBytes,
    uploadEligible: optimized.uploadEligible,
    optimizationProfile: optimized.optimizationProfile,
    blockReason: optimized.blockReason,
    uploadLimitBytes: SIMPLE_UPLOAD_LIMIT_BYTES,
    safeUploadBytes: SAFE_UPLOAD_BYTES,
    probe: optimized.probe,
    analysisApplicable: kind.isVideo,
    thumbPath: bestFrame.thumbPath || '',
    candidateThumbs,
    bestFrame,
    warnings,
  };

  process.stdout.write(JSON.stringify(result));
}

main();

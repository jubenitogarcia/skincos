#!/usr/bin/env node

const fs = require('fs');

const inputPath = process.argv[2] || 'workflows/livia.json';
const outputPath = process.argv[3] || inputPath;

function readWorkflow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeWorkflow(filePath, workflow) {
  fs.writeFileSync(filePath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function replaceExact(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  return source.replace(from, to);
}

function patchCompose2(code) {
  const oldSelectMainUpload = `function selectMainUpload(uploadItems, media, index, warnings, context) {
  const upload = (uploadItems[index] && uploadItems[index].json) || {};
  const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));
  const kind = detectMediaKindSmart(media?.mimeType, directUrl || media?.webContentLink || media?.url || "");

  if (!directUrl) {
    throw new Error(
      \`Compose (2): Upload Main Media sem secure_url/url (\${context}, globalIdx=\${index}, mediaId=\${str(media?.id, "n/a")}, mediaName=\${str(media?.name, "n/a")})\`
    );
  }

  if (kind.isVideo && !uploadLooksLikeVideo(upload, directUrl)) {
    throw new Error(
      \`Compose (2): Upload Main Media retornou URL incompatível para vídeo (\${context}, globalIdx=\${index}, mediaName=\${str(media?.name, "n/a")}, resource_type=\${str(upload.resource_type, "n/a")}, url=\${directUrl})\`
    );
  }

  if (kind.isImage && uploadLooksLikeVideo(upload, directUrl)) {
    throw new Error(
      \`Compose (2): Upload Main Media retornou vídeo para mídia de imagem (\${context}, globalIdx=\${index}, mediaName=\${str(media?.name, "n/a")}, url=\${directUrl})\`
    );
  }

  if (kind.isVideo) pushUnique(warnings, "video_url validado a partir de Upload Main Media");
  return { upload, directUrl };
}`;

  const newSelectMainUpload = `function selectMainUpload(uploadItems, media, index, warnings, context) {
  const upload = (uploadItems[index] && uploadItems[index].json) || {};
  const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));
  const kind = detectMediaKindSmart(media?.mimeType, directUrl || media?.webContentLink || media?.url || "");

  if (!directUrl) {
    throw new Error(
      \`Compose (2): Upload Main Media sem secure_url/url (\${context}, globalIdx=\${index}, mediaId=\${str(media?.id, "n/a")}, mediaName=\${str(media?.name, "n/a")})\`
    );
  }

  if (kind.isVideo && !uploadLooksLikeVideo(upload, directUrl)) {
    throw new Error(
      \`Compose (2): Upload Main Media retornou URL incompatível para vídeo (\${context}, globalIdx=\${index}, mediaName=\${str(media?.name, "n/a")}, resource_type=\${str(upload.resource_type, "n/a")}, url=\${directUrl})\`
    );
  }

  if (kind.isImage && uploadLooksLikeVideo(upload, directUrl)) {
    throw new Error(
      \`Compose (2): Upload Main Media retornou vídeo para mídia de imagem (\${context}, globalIdx=\${index}, mediaName=\${str(media?.name, "n/a")}, url=\${directUrl})\`
    );
  }

  const mediaAudit = removeNulls({
    event: kind.isVideo ? "main_video_url_validated" : "main_media_url_validated",
    source: "Upload Main Media",
    context,
    mediaKind: kind.isVideo ? "video" : (kind.isImage ? "image" : ""),
    resource_type: str(upload.resource_type || "", ""),
    format: str(upload.format || "", ""),
    secure_url: directUrl,
  });

  return { upload, directUrl, mediaAudit };
}`;

  code = replaceExact(code, oldSelectMainUpload, newSelectMainUpload, 'Compose (2) selectMainUpload');

  code = replaceExact(
    code,
    'function pushMediaAvailabilityJob({ group, unitKey, platform, c2, finalUrl, localIdx, warnings }) {',
    'function pushMediaAvailabilityJob({ group, unitKey, platform, c2, finalUrl, localIdx, warnings, mediaAudit }) {',
    'Compose (2) media availability signature',
  );
  code = replaceExact(
    code,
    `      warnings,
      publishRunIndex: runIndex,`,
    `      warnings,
      mediaAudit,
      publishRunIndex: runIndex,`,
    'Compose (2) media availability audit output',
  );

  code = replaceExact(
    code,
    `        const { directUrl } = selectMainUpload(
          uploadItems,
          c2,
          firstIndex,
          fileWarnings,
          \`facebook/reels groupKey=\${group.groupKey}\`
        );`,
    `        const { directUrl, mediaAudit } = selectMainUpload(
          uploadItems,
          c2,
          firstIndex,
          fileWarnings,
          \`facebook/reels groupKey=\${group.groupKey}\`
        );`,
    'Compose (2) facebook reels selectMainUpload destructure',
  );
  code = replaceExact(
    code,
    `          warnings: [...warnings, ...fileWarnings, ...livWarn],
        });`,
    `          warnings: [...warnings, ...fileWarnings, ...livWarn],
          mediaAudit,
        });`,
    'Compose (2) facebook reels media availability audit',
  );
  code = replaceExact(
    code,
    `            warnings: [...warnings, ...fileWarnings, ...livWarn],
            publishRunIndex: startRun,`,
    `            warnings: [...warnings, ...fileWarnings, ...livWarn],
            mediaAudit,
            publishRunIndex: startRun,`,
    'Compose (2) facebook reels start audit',
  );
  code = replaceExact(
    code,
    `            warnings: [...warnings, ...fileWarnings, ...livWarn],
            publishRunIndex: uploadRun,`,
    `            warnings: [...warnings, ...fileWarnings, ...livWarn],
            mediaAudit,
            publishRunIndex: uploadRun,`,
    'Compose (2) facebook reels upload audit',
  );

  code = replaceExact(
    code,
    `          const { directUrl } = selectMainUpload(
            uploadItems,
            c2,
            globalIdx,
            fileWarnings,
            \`platform=\${platform}, groupKey=\${group.groupKey}, localIdx=\${localIdx}\`
          );`,
    `          const { directUrl, mediaAudit } = selectMainUpload(
            uploadItems,
            c2,
            globalIdx,
            fileWarnings,
            \`platform=\${platform}, groupKey=\${group.groupKey}, localIdx=\${localIdx}\`
          );`,
    'Compose (2) default selectMainUpload destructure',
  );
  code = replaceExact(
    code,
    `            warnings: [...warnings, ...fileWarnings],
          });`,
    `            warnings: [...warnings, ...fileWarnings],
            mediaAudit,
          });`,
    'Compose (2) default media availability audit',
  );
  code = replaceExact(
    code,
    `              warnings: [...warnings, ...fileWarnings],
              publishRunIndex: myRun,`,
    `              warnings: [...warnings, ...fileWarnings],
              mediaAudit,
              publishRunIndex: myRun,`,
    'Compose (2) default upload audit',
  );

  if (code.includes('video_url validado a partir de Upload Main Media')) {
    throw new Error('Compose (2) still contains video_url validation warning text');
  }

  return code;
}

function patchPrepareRequest(code) {
  const oldFacebookWarnings = `function facebookReelsStatusWarnings({ platform, checkKind, body }) {
  const plat = String(platform || "").toLowerCase();
  const kind = String(checkKind || "").toLowerCase();
  if (plat !== "facebook" && !kind.startsWith("fb_")) return [];
  if (kind !== "fb_reels_video") return [];

  const status = body && typeof body === "object" && body.status && typeof body.status === "object"
    ? body.status
    : {};
  const warnings = [];
  const copyrightStatus = String(status?.copyright_check_status?.status || "").trim().toLowerCase();
  const processingStatus = String(status?.processing_phase?.status || "").trim().toLowerCase();
  const publishingStatus = String(status?.publishing_phase?.status || "").trim().toLowerCase();

  if (copyrightStatus && copyrightStatus !== "complete") {
    warnings.push(\`facebook.reels: copyright_check_status=\${copyrightStatus}\`);
  }
  if (processingStatus && !["complete", "completed"].includes(processingStatus)) {
    warnings.push(\`facebook.reels: processing_phase.status=\${processingStatus}\`);
  }
  if (publishingStatus && !["complete", "completed"].includes(publishingStatus)) {
    warnings.push(\`facebook.reels: publishing_phase.status=\${publishingStatus}\`);
  }

  return warnings;
}`;

  const newFacebookWarnings = `function facebookReelsStatusWarnings({ platform, checkKind, body }) {
  const plat = String(platform || "").toLowerCase();
  const kind = String(checkKind || "").toLowerCase();
  if (plat !== "facebook" && !kind.startsWith("fb_")) return { warnings: [], statusNotes: [] };
  if (kind !== "fb_reels_video") return { warnings: [], statusNotes: [] };

  const status = body && typeof body === "object" && body.status && typeof body.status === "object"
    ? body.status
    : {};
  const warnings = [];
  const statusNotes = [];
  const copyrightStatus = String(status?.copyright_check_status?.status || "").trim().toLowerCase();
  const processingStatus = String(status?.processing_phase?.status || "").trim().toLowerCase();
  const publishingStatus = String(status?.publishing_phase?.status || "").trim().toLowerCase();
  const matchesFound = status?.copyright_check_status?.matches_found === true;
  const fatalStatuses = ["failed", "failure", "error", "rejected", "expired", "blocked"];

  function isComplete(s) {
    return ["complete", "completed"].includes(String(s || "").trim().toLowerCase());
  }

  function isFatal(s) {
    const normalized = String(s || "").trim().toLowerCase();
    return fatalStatuses.some((fatal) => normalized.includes(fatal));
  }

  function recordStatus(label, value, options = {}) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || isComplete(normalized)) return;
    const message = \`facebook.reels: \${label}=\${normalized}\`;
    if (options.warnOnMatch === true || isFatal(normalized)) {
      warnings.push(message);
      return;
    }
    statusNotes.push(message);
  }

  recordStatus("copyright_check_status", copyrightStatus, { warnOnMatch: matchesFound });
  recordStatus("processing_phase.status", processingStatus);
  recordStatus("publishing_phase.status", publishingStatus);

  return { warnings, statusNotes };
}`;

  code = replaceExact(code, oldFacebookWarnings, newFacebookWarnings, 'Prepare Request facebookReelsStatusWarnings');
  code = replaceExact(
    code,
    `    const statusWarnings = facebookReelsStatusWarnings({
      platform: job.platform,
      checkKind: job.checkKind,
      body: httpBody,
    });`,
    `    const statusSignal = facebookReelsStatusWarnings({
      platform: job.platform,
      checkKind: job.checkKind,
      body: httpBody,
    });`,
    'Prepare Request status signal variable',
  );
  code = replaceExact(
    code,
    `        warnings: mergeWarnings(job.warnings, statusWarnings),
        // metadado útil para debug/auditoria
        lastResponseBody: httpBody,`,
    `        warnings: mergeWarnings(job.warnings, statusSignal.warnings),
        statusNotes: mergeWarnings(job.statusNotes, statusSignal.statusNotes),
        // metadado útil para debug/auditoria
        lastResponseBody: httpBody,`,
    'Prepare Request status notes output',
  );

  return code;
}

function main() {
  const workflow = readWorkflow(inputPath);
  const compose2 = getNode(workflow, 'Compose (2)');
  const prepare = getNode(workflow, 'Prepare Request');

  compose2.parameters.jsCode = patchCompose2(compose2.parameters.jsCode);
  prepare.parameters.jsCode = patchPrepareRequest(prepare.parameters.jsCode);

  writeWorkflow(outputPath, workflow);
  console.log(JSON.stringify({
    inputPath,
    outputPath,
    nodes: workflow.nodes.length,
    patched: ['Compose (2)', 'Prepare Request'],
  }, null, 2));
}

main();

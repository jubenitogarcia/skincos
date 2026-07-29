#!/usr/bin/env node

'use strict';

// Make every provider-verification target carry an ordered, media-level
// accessibility contract.  This replaces the former first-alt-text lookup,
// which could report a group as healthy even when a later carousel child lost
// its required alt text.

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const NODE_NAME = 'Collect Publish Results';
const START_MARKER = 'function buildPublishVerificationTargets(completedRows, groupKey) {';
const END_MARKER = '\n\nconst codexDryRun';

const TARGET_FUNCTION = String.raw`function buildPublishVerificationTargets(completedRows, groupKey) {
  const rows = __prAsArray(completedRows).filter((entry) => __prStr(__prAsObject(entry).groupKey, "") === __prStr(groupKey, ""));
  function requestBody(row) {
    const current = __prAsObject(row);
    const http = __prAsObject(current.httpRequest);
    for (const candidate of [current.requestBody, current.jsonRequest, http.body, http.json]) {
      const body = __prAsObject(candidate);
      if (Object.keys(body).length) return body;
    }
    return {};
  }
  function firstSubmitted(platformRows, keys) {
    for (const row of platformRows) {
      const body = requestBody(row);
      for (const key of keys) {
        if (body[key] !== undefined && body[key] !== null && __prStr(body[key], "").trim() !== "") return __prStr(body[key], "");
      }
    }
    return "";
  }
  function mediaKindFor(platformRows, publishRow) {
    const signals = [];
    for (const row of platformRows) {
      const current = __prAsObject(row);
      const body = requestBody(current);
      signals.push(
        current.mediaKind,
        __prAsObject(current.media).mediaKind,
        current.mediaType,
        current.media_type,
        current.groupBaseMediaType,
        current.step,
        current.url,
        __prAsObject(current.httpRequest).url,
        body.media_type,
        body.image_url ? "image" : "",
        body.video_url || body.file_url ? "video" : "",
        body.attached_media ? "image" : ""
      );
    }
    signals.push(publishRow.mediaKind, __prAsObject(publishRow.media).mediaKind);
    const raw = signals.map((value) => __prStr(value, "").toLowerCase()).join(" ");
    if (raw.includes("carousel")) return "carousel";
    if (raw.includes("video") || raw.includes("reels") || raw.includes("reel")) return "video";
    if (raw.includes("image") || raw.includes("photo")) return "image";
    return "image";
  }
  function mediaAccessibilityContract(platformRows, platform) {
    const items = [];
    const seenSemanticKeys = new Set();
    const seenSourceItems = new Set();
    for (const row of platformRows) {
      const current = __prAsObject(row);
      if (__prStr(current.phase, "").toLowerCase() !== "upload") continue;
      const body = requestBody(current);
      const mediaType = __prStr(body.media_type || body.mediaType, "").toUpperCase();
      const step = __prStr(current.step, "").toLowerCase();
      const mediaKind = body.video_url || body.file_url ? "video"
        : body.image_url || (platform === "facebook" && body.url) ? "image"
          : platform === "facebook" && step === "reels_start" ? "video" : "";
      if (!mediaKind || mediaType === "CAROUSEL") continue;
      const media = __prAsObject(current.media);
      const sourceMediaId = __prStr(media.id || current.sourceMediaId, "");
      const semanticJobKey = __prStr(current.semanticJobKey, "");
      const groupOrder = Number(media.groupOrder ?? current.groupOrder);
      if (!sourceMediaId || !semanticJobKey || !Number.isInteger(groupOrder) || groupOrder < 0) {
        throw new Error("Collect Publish Results: accessibility evidence is missing semantic media identity for " + platform + ".");
      }
      if (seenSemanticKeys.has(semanticJobKey)) {
        throw new Error("Collect Publish Results: duplicate accessibility semantic job key for " + platform + ": " + semanticJobKey + ".");
      }
      const sourceKey = sourceMediaId + "|" + groupOrder;
      if (seenSourceItems.has(sourceKey)) {
        throw new Error("Collect Publish Results: duplicate accessibility source media identity for " + platform + ": " + sourceKey + ".");
      }
      seenSemanticKeys.add(semanticJobKey);
      seenSourceItems.add(sourceKey);
      const text = __prAsObject(current.text);
      const expectedAltText = __prStr(text.alt_text || text.altText, "");
      const submittedAltText = firstSubmitted([current], ["alt_text", "altText", "alt_text_custom"]);
      const providerBody = __prAsObject(current.lastResponseBody);
      const providerMediaId = __prStr(providerBody.video_id || providerBody.creation_id || providerBody.id || providerBody.post_id || providerBody.videoid, "");
      if (!providerMediaId) {
        throw new Error("Collect Publish Results: provider media id is missing for " + platform + "/" + sourceMediaId + ".");
      }
      const support = platform === "facebook" || (platform === "instagram" && mediaKind === "video")
        ? "unsupported"
        : "required";
      if (support === "required" && (!expectedAltText || !submittedAltText || submittedAltText !== expectedAltText)) {
        throw new Error("Collect Publish Results: required alt_text is missing or does not match editorial evidence for " + platform + "/" + sourceMediaId + ".");
      }
      if (support === "unsupported" && submittedAltText) {
        throw new Error("Collect Publish Results: unsupported alt_text was sent for " + platform + "/" + sourceMediaId + ".");
      }
      items.push({
        sourceMediaId,
        groupOrder,
        semanticJobKey,
        mediaKind,
        support,
        expectedAltText,
        submittedAltText,
        providerMediaId,
      });
    }
    if (!items.length) throw new Error("Collect Publish Results: no media-level accessibility evidence for " + platform + ".");
    items.sort((left, right) => left.groupOrder - right.groupOrder || left.sourceMediaId.localeCompare(right.sourceMediaId) || left.semanticJobKey.localeCompare(right.semanticJobKey));
    const required = items.filter((entry) => entry.support === "required");
    return {
      schema: "livia.media-alt-text.v1",
      orderedBy: "groupOrder",
      items,
      requiredCount: required.length,
      submittedRequiredCount: required.filter((entry) => entry.submittedAltText).length,
      unsupportedCount: items.filter((entry) => entry.support === "unsupported").length,
    };
  }
  const targets = [];
  for (const unit of ["bss", "nh"]) {
    for (const platform of ["instagram", "facebook", "threads"]) {
      const platformRows = rows.filter((entry) =>
        __prStr(__prAsObject(entry).unit, "").toLowerCase() === unit &&
        __prStr(__prAsObject(entry).platform, "").toLowerCase() === platform
      );
      const publishRow = __prAsObject(platformRows.find((entry) => __prStr(__prAsObject(entry).phase, "").toLowerCase() === "publish"));
      if (!Object.keys(publishRow).length) continue;
      const publishBody = __prAsObject(publishRow.lastResponseBody);
      const startRow = __prAsObject(platformRows.find((entry) => __prStr(__prAsObject(entry).step, "").toLowerCase() === "reels_start"));
      const startBody = __prAsObject(startRow.lastResponseBody);
      const uploadRow = __prAsObject(platformRows.find((entry) => __prStr(__prAsObject(entry).phase, "").toLowerCase() === "upload"));
      const uploadBody = __prAsObject(uploadRow.lastResponseBody);
      const accessibilityContract = mediaAccessibilityContract(platformRows, platform);
      const mediaEvidenceContract = {
        schema: "livia.media-evidence.v1",
        orderedBy: "groupOrder",
        items: accessibilityContract.items.map((entry) => ({
          sourceMediaId: entry.sourceMediaId,
          groupOrder: entry.groupOrder,
          semanticJobKey: entry.semanticJobKey,
          mediaKind: entry.mediaKind,
          providerMediaId: entry.providerMediaId,
        })),
      };
      const mediaKind = mediaEvidenceContract.items.length > 1 ? "carousel" : mediaKindFor(platformRows, publishRow);
      const publishMode = platformRows.some((entry) => __prStr(__prAsObject(entry).step, "").toLowerCase().startsWith("reels_"))
        ? "reels"
        : mediaEvidenceContract.items.length > 1 ? "carousel" : mediaKind === "carousel" ? "carousel" : "static";
      const providerObjectId = platform === "facebook" && publishMode === "reels"
        ? __prStr(startBody.video_id || startBody.id || publishBody.id || publishBody.post_id, "")
        : __prStr(publishBody.id || publishBody.post_id || uploadBody.post_id || uploadBody.id, "");
      const providerMediaId = platform === "facebook" && publishMode === "reels"
        ? __prStr(startBody.video_id || startBody.id, "")
        : __prStr(mediaEvidenceContract.items[0]?.providerMediaId || uploadBody.id || uploadBody.post_id, "");
      if (!providerObjectId) {
        throw new Error("Collect Publish Results: identificador final ausente para " + platform + "/" + unit + ".");
      }
      const text = __prAsObject(publishRow.text);
      targets.push({
        platform,
        unit,
        mediaKind,
        publishMode,
        providerObjectId,
        providerMediaId,
        expected: {
          caption: __prStr(text.caption || text.text, ""),
          title: __prStr(text.title, ""),
          altText: __prStr(text.alt_text || text.altText, ""),
        },
        submitted: {
          title: __prStr(firstSubmitted(platformRows, ["title"]), ""),
          altText: __prStr(firstSubmitted(platformRows, ["alt_text", "altText", "alt_text_custom"]), ""),
          coverUrl: __prStr(firstSubmitted(platformRows, ["cover_url"]), ""),
          thumbOffset: firstSubmitted(platformRows, ["thumb_offset"]),
        },
        accessibilityContract,
        mediaEvidenceContract,
      });
    }
  }
  return targets;
}`;

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function required(name) {
  const current = value(name);
  if (!current) throw new Error(`${name} is required.`);
  return current;
}

function readWorkflow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function patchCode(code) {
  const current = String(code || '');
  const start = current.indexOf(START_MARKER);
  const end = start >= 0 ? current.indexOf(END_MARKER, start) : -1;
  if (start < 0 || end < 0) {
    throw new Error(`${NODE_NAME} does not contain the expected verification-target function.`);
  }
  return `${current.slice(0, start)}${TARGET_FUNCTION}${current.slice(end)}`;
}

function patchWorkflow(workflow) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const candidate = structuredClone(workflow);
  const node = (candidate.nodes || []).find((entry) => entry?.name === NODE_NAME);
  if (!node || node.type !== 'n8n-nodes-base.code') throw new Error(`${NODE_NAME} must be a Code node.`);
  node.parameters ||= {};
  node.parameters.jsCode = patchCode(node.parameters.jsCode);
  return candidate;
}

function main() {
  const input = required('--input');
  const output = required('--output');
  const patched = patchWorkflow(readWorkflow(input));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(patched, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, workflowId: patched.id, node: NODE_NAME, output })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || String(error));
    process.exit(1);
  }
}

module.exports = { NODE_NAME, TARGET_FUNCTION, patchCode, patchWorkflow };

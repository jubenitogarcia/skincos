#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const unitConfig = {
  barrashoppingsul: {
    placeId: "ChIJZdhuMFx5GZURql2Gm6xa8LU",
    gbpLocation: "5938225121025805282",
  },
  "novo-hamburgo": {
    placeId: "ChIJhaCsZ9RDGZURe9I0bpIb-CM",
    gbpLocation: "7339519901965290091",
  },
};

const inputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(process.cwd(), "tmp/manual-reviews");

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return Number.isFinite(value) ? String(value) : "NULL";
}

function parseDisplayedReviewCount(input) {
  const match = String(input ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function parseDisplayedRating(input) {
  const normalized = String(input ?? "").trim().replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseRelativeTimeToMs(timeText, nowMs) {
  const raw = String(timeText ?? "").trim().toLowerCase();
  if (!raw) return null;

  const normalized = raw.replace(/^editado\s+/, "");
  const amountMatch = normalized.match(/^(\d+|um|uma)\s+(dia|dias|semana|semanas|m[eê]s|meses|ano|anos)\s+atr[aá]s$/i);
  if (!amountMatch) return null;

  const amountToken = amountMatch[1];
  const unitToken = amountMatch[2];
  const amount = amountToken === "um" || amountToken === "uma" ? 1 : Number(amountToken);

  const unitMsMap = {
    dia: 24 * 60 * 60 * 1000,
    dias: 24 * 60 * 60 * 1000,
    semana: 7 * 24 * 60 * 60 * 1000,
    semanas: 7 * 24 * 60 * 60 * 1000,
    "mês": 30 * 24 * 60 * 60 * 1000,
    mes: 30 * 24 * 60 * 60 * 1000,
    meses: 30 * 24 * 60 * 60 * 1000,
    ano: 365 * 24 * 60 * 60 * 1000,
    anos: 365 * 24 * 60 * 60 * 1000,
  };

  const unitMs = unitMsMap[unitToken];
  if (!unitMs || !Number.isFinite(amount)) return null;
  return nowMs - amount * unitMs;
}

function buildSyncRunId(unitSlug, syncedAtMs) {
  return `manual_${unitSlug}_${syncedAtMs}`;
}

function readManualFile(fileName) {
  const fullPath = path.join(inputDir, fileName);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function buildSqlForPayload(payload) {
  const unitSlug = payload.unitSlug;
  const config = unitConfig[unitSlug];
  if (!config) {
    throw new Error(`unsupported_unit:${unitSlug}`);
  }

  const nowMs = Date.now();
  const syncedAtMs = Date.parse(payload.exportedAt) || nowMs;
  const totalReviews = Number(payload.summary?.extractedReviewCount ?? payload.reviews?.length ?? 0);
  const averageRating =
    typeof payload.summary?.extractedAverageRating === "number"
      ? payload.summary.extractedAverageRating
      : parseDisplayedRating(payload.summary?.displayedRating);
  const syncRunId = buildSyncRunId(unitSlug, syncedAtMs);

  const statements = [
    `DELETE FROM gbp_reviews WHERE unit_slug = ${sqlString(unitSlug)};`,
    `DELETE FROM gbp_review_summaries WHERE unit_slug = ${sqlString(unitSlug)};`,
    `DELETE FROM gbp_review_sync_runs WHERE unit_slug = ${sqlString(unitSlug)};`,
    `INSERT INTO gbp_review_summaries (
      unit_slug, place_id, gbp_location, location_resource_name,
      average_rating, total_reviews, reviews_synced, synced_at_ms,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${sqlString(unitSlug)},
      ${sqlString(config.placeId)},
      ${sqlString(config.gbpLocation)},
      NULL,
      ${sqlNumber(averageRating)},
      ${sqlNumber(totalReviews)},
      ${sqlNumber(payload.reviews.length)},
      ${sqlNumber(syncedAtMs)},
      ${sqlNumber(nowMs)},
      ${sqlNumber(nowMs)}
    );`,
  ];

  for (const review of payload.reviews) {
    const reviewTimeMs = parseRelativeTimeToMs(review.timeText, syncedAtMs);
    const payloadJson = JSON.stringify({
      source: payload.source,
      exportedAt: payload.exportedAt,
      review,
    });

    statements.push(`INSERT INTO gbp_reviews (
      id, unit_slug, place_id, reviewer_name, star_rating, comment,
      create_time_ms, update_time_ms, review_reply_comment, review_reply_update_ms,
      payload_json, created_at_ms, updated_at_ms
    ) VALUES (
      ${sqlString(review.id)},
      ${sqlString(unitSlug)},
      ${sqlString(config.placeId)},
      ${sqlString(review.name || "Paciente")},
      ${sqlNumber(review.rating)},
      ${sqlString(review.text || null)},
      ${sqlNumber(reviewTimeMs)},
      ${sqlNumber(reviewTimeMs)},
      ${sqlString(review.ownerResponse || null)},
      ${sqlNumber(reviewTimeMs)},
      ${sqlString(payloadJson)},
      ${sqlNumber(nowMs)},
      ${sqlNumber(nowMs)}
    );`);
  }

  statements.push(`INSERT INTO gbp_review_sync_runs (
    id, unit_slug, place_id, started_at_ms, finished_at_ms, success, fetched_reviews, error
  ) VALUES (
    ${sqlString(syncRunId)},
    ${sqlString(unitSlug)},
    ${sqlString(config.placeId)},
    ${sqlNumber(syncedAtMs)},
    ${sqlNumber(nowMs)},
    1,
    ${sqlNumber(payload.reviews.length)},
    NULL
  );`);

  return statements.join("\n\n");
}

const payloads = [
  readManualFile("barrashoppingsul.manual-google-reviews.json"),
  readManualFile("novo-hamburgo.manual-google-reviews.json"),
];

const sql = payloads.map(buildSqlForPayload).join("\n\n");
process.stdout.write(`${sql}\n`);

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const requestedExecutionId = (() => {
  const argument = process.argv.find((value) => /^--execution-id=\d+$/.test(String(value)));
  return argument ? String(argument).split('=')[1] : '';
})();
const inspectMode = process.argv.includes('--inspect');
const emittedJobsPath = (() => {
  const argument = process.argv.find((value) => String(value).startsWith('--emit-jobs='));
  return argument ? path.resolve(String(argument).slice('--emit-jobs='.length)) : '';
})();

function loadRuntimeModule(name) {
  try { return require(`/usr/local/lib/node_modules/n8n/node_modules/${name}`); }
  catch { return require(name); }
}

const { Client } = loadRuntimeModule('pg');
const { parse } = loadRuntimeModule('flatted');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sourceRoot = path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish');

function outputItems(runData, name) {
  const run = Array.isArray(runData[name]) ? runData[name][0] : null;
  return Array.isArray(run?.data?.main?.[0]) ? run.data.main[0] : [];
}

function allOutputItems(runData, name) {
  const executions = Array.isArray(runData[name]) ? runData[name] : [];
  return executions.flatMap((run) =>
    (Array.isArray(run?.data?.main) ? run.data.main : [])
      .flatMap((branch) => (Array.isArray(branch) ? branch : [])),
  );
}

function outputBranchItems(runData, name, branchIndex) {
  const executions = Array.isArray(runData[name]) ? runData[name] : [];
  return executions.flatMap((run) => {
    const branch = Array.isArray(run?.data?.main) ? run.data.main[branchIndex] : [];
    return Array.isArray(branch) ? branch : [];
  });
}

function outputBranchCounts(runData, name) {
  const executions = Array.isArray(runData[name]) ? runData[name] : [];
  return executions.map((run) =>
    (Array.isArray(run?.data?.main) ? run.data.main : [])
      .map((branch) => (Array.isArray(branch) ? branch.length : 0)),
  );
}

function jsonOf(item) {
  return item && typeof item.json === 'object' && item.json ? item.json : {};
}

function creativeShape(item) {
  const row = jsonOf(item);
  const payload = row.creativePayload && typeof row.creativePayload === 'object' ? row.creativePayload : {};
  const feed = payload.asset_feed_spec && typeof payload.asset_feed_spec === 'object' ? payload.asset_feed_spec : {};
  const story = payload.object_story_spec && typeof payload.object_story_spec === 'object' ? payload.object_story_spec : {};
  return {
    destination_group: String(row.destination_group || ''),
    ad_name: String(row.adPayload?.name || ''),
    media_mode: String(row.media_mode || ''),
    media_variant: String(row.media_variant || ''),
    action: String(row.action || ''),
    ad_status: String((row.adPayload && row.adPayload.status) || ''),
    asset_feed_present: Object.keys(feed).length > 0,
    story_video_present: Boolean(story.video_data && Object.keys(story.video_data).length),
    ad_formats: Array.isArray(feed.ad_formats) ? feed.ad_formats : [],
    image_count: Array.isArray(feed.images) ? feed.images.length : 0,
    video_count: Array.isArray(feed.videos) ? feed.videos.length : 0,
    body_count: Array.isArray(feed.bodies) ? feed.bodies.length : 0,
    title_count: Array.isArray(feed.titles) ? feed.titles.length : 0,
    description_count: Array.isArray(feed.descriptions) ? feed.descriptions.length : 0,
    placement_rule_count: Array.isArray(feed.asset_customization_rules) ? feed.asset_customization_rules.length : 0,
    requested_enhancement_count: Array.isArray(row.advantage_plus_requested_features) ? row.advantage_plus_requested_features.length : 0,
    requested_enhancements: Array.isArray(row.advantage_plus_requested_features) ? row.advantage_plus_requested_features : [],
    skipped_enhancement_count: Array.isArray(row.advantage_plus_skipped_features) ? row.advantage_plus_skipped_features.length : 0,
    skipped_enhancements: Array.isArray(row.advantage_plus_skipped_features) ? row.advantage_plus_skipped_features : [],
    enhancement_skip_reasons: row.advantage_plus_skip_reasons && typeof row.advantage_plus_skip_reasons === 'object'
      ? row.advantage_plus_skip_reasons
      : {},
  };
}

async function executeCode(fileName, input, itemsByNode) {
  const code = fs.readFileSync(path.join(sourceRoot, fileName), 'utf8');
  const execute = new AsyncFunction('$input', '$items', '$', code);
  return execute(
    { all: () => input },
    (name) => itemsByNode[name] || [],
    (name) => ({ all: () => itemsByNode[name] || [] }),
  );
}

async function main() {
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.id, e.status, d.data
         FROM n8n_runtime.execution_entity e
         JOIN n8n_runtime.execution_data d ON d."executionId" = e.id
        WHERE e."workflowId" = $1
          AND ($2 = '' OR e.id = $2::int)
        ORDER BY e.id DESC
        LIMIT 1`,
      [WORKFLOW_ID, requestedExecutionId],
    );
    if (!result.rows.length) throw new Error('Nenhuma execucao persistida para replay.');
    const payload = parse(result.rows[0].data);
    const runData = payload.resultData?.runData || {};
    const buildPayload = outputItems(runData, 'Build Payload');
    const livia = outputItems(runData, 'Livia');
    const images = allOutputItems(runData, 'Normalize Gateway Upload');
    const processedVideos = allOutputItems(runData, 'Parse Processed Video');
    const processedVideoGeometry = allOutputItems(runData, 'Attach Video Thumbnail')
      .map((entry) => {
        const value = jsonOf(entry);
        const processing = value.media_processing && typeof value.media_processing === 'object'
          ? value.media_processing
          : {};
        return {
          source_file_id: String(processing.source_file_id || value.source_file_id || value.id || ''),
          width: Number(processing.width || 0),
          height: Number(processing.height || 0),
        };
      })
      .filter((entry) => entry.width > 0 && entry.height > 0);
    // Video Ready? can execute repeatedly while Graph transcodes the asset.
    // Only its true/ready branch is a completed upload receipt; flattening all
    // branches would re-introduce intermediate `processing` items in replay.
    const videos = outputBranchItems(runData, 'Video Ready?', 0).map((entry) => {
      const value = jsonOf(entry);
      if (Number(value.video_width || 0) > 0 && Number(value.video_height || 0) > 0 &&
          Number(value.preferred_thumbnail_width || 0) > 0 && Number(value.preferred_thumbnail_height || 0) > 0) {
        return entry;
      }
      const sourceFileId = String(value.source_file_id || '');
      const geometry = processedVideoGeometry.find((candidate) =>
        sourceFileId && candidate.source_file_id === sourceFileId,
      ) || (processedVideoGeometry.length === 1 ? processedVideoGeometry[0] : null);
      if (!geometry) return entry;
      return {
        ...entry,
        json: {
          ...value,
          video_width: Number(value.video_width || geometry.width),
          video_height: Number(value.video_height || geometry.height),
          video_aspect_ratio: String(value.video_aspect_ratio || '9x16'),
          video_recommended_aspect_ratio: String(value.video_recommended_aspect_ratio || '9x16'),
          preferred_thumbnail_width: Number(value.preferred_thumbnail_width || geometry.width),
          preferred_thumbnail_height: Number(value.preferred_thumbnail_height || geometry.height),
          preferred_thumbnail_aspect_ratio: String(value.preferred_thumbnail_aspect_ratio || '9x16'),
          replay_geometry_source: 'persisted_video_processing',
        },
      };
    });
    if (!buildPayload.length || !livia.length) {
      if (inspectMode) {
        const executionError = payload.resultData?.error || {};
        console.log(JSON.stringify({
          mode: 'read_only_execution_progress',
          source_execution_id: result.rows[0].id,
          source_execution_status: result.rows[0].status,
          last_node_executed: String(payload.resultData?.lastNodeExecuted || ''),
          executed_nodes: Object.keys(runData),
          build_payload_items: buildPayload.length,
          livia_items: livia.length,
          execution_error: {
            node: String(executionError.node?.name || executionError.node || ''),
            message: String(executionError.message || ''),
            description: String(executionError.description || ''),
          },
          meta_mutations_performed: false,
        }, null, 2));
        return;
      }
      throw new Error('Execucao mais recente nao possui Build Payload e Livia necessarios para replay.');
    }

    const named = {
      'Build Payload': buildPayload,
      'Livia': livia,
      'Normalize Gateway Upload': images,
      'Video Ready?': videos,
      'Restore Publish Groups': outputItems(runData, 'Restore Publish Groups'),
      'Build Meta API Params From Vault': outputItems(runData, 'Build Meta API Params From Vault'),
    };
    const plans = await executeCode('prepare-media-upload-plan.js', buildPayload, named);
    named['Prepare Media Upload Plan'] = plans;

    const noImagePlans = plans.filter((entry) => Number(entry.json?.media_upload_plan?.expected?.images || 0) === 0);
    const noVideoPlans = plans.filter((entry) => Number(entry.json?.media_upload_plan?.expected?.videos || 0) === 0);
    const noImages = noImagePlans.length ? await executeCode('emit-no-image-upload.js', noImagePlans, named) : [];
    const noVideos = noVideoPlans.length ? await executeCode('emit-no-video-upload.js', noVideoPlans, named) : [];
    const envelopes = await executeCode(
      'aggregate-media-upload-results.js',
      [...images, ...videos, ...noImages, ...noVideos],
      named,
    );
    const assemblies = await executeCode('assemble-job-inputs.js', [...livia, ...envelopes], named);
    let jobs = [];
    let replayBuildError = '';
    try {
      jobs = await executeCode('build-jobs.js', assemblies, named);
    } catch (error) {
      replayBuildError = String(error?.message || error || 'build_jobs_replay_failed');
      if (!inspectMode) throw error;
    }
    const errors = jobs.filter((entry) => String(entry.json?.error || '').trim());
    let validatedJobs = [];
    let replayValidationError = '';
    if (!errors.length) {
      try {
        validatedJobs = await executeCode('validate-meta-creative-payload.js', jobs, named);
      } catch (error) {
        replayValidationError = String(error?.message || error || 'validate_creative_replay_failed');
        if (!inspectMode) throw error;
      }
    }

    const persistedBuildJobs = allOutputItems(runData, 'Build Jobs');
    const persistedValidated = allOutputItems(runData, 'Validate Meta Creative Payload');
    const persistedAdvantageReadback = allOutputItems(runData, 'Attach Advantage+ Verification');
    const persistedPlacementChecks = allOutputItems(runData, 'Validate Meta Placement Eligibility')
      .flatMap((entry) => Array.isArray(jsonOf(entry).placement_checks) ? jsonOf(entry).placement_checks : []);
    const persistedFinalization = allOutputItems(runData, 'Build Drive Finalization');
    const persistedVideoStarts = allOutputItems(runData, 'Prepare Video Upload Starts');
    const persistedVideoStartResponses = allOutputItems(runData, 'Start Video Upload');
    const persistedCreativeResponses = allOutputItems(runData, 'Create AdCreative');

    // A failed live execution already contains the expensive, deterministic
    // inputs (grouping, Livia copy and upload receipts).  Emit the rebuilt
    // current-contract jobs only on explicit request so an operator can drive
    // a downstream calibration without invoking either AI node again.
    if (emittedJobsPath) {
      const directory = path.dirname(emittedJobsPath);
      fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
      fs.writeFileSync(emittedJobsPath, `${JSON.stringify({
        source_execution_id: result.rows[0].id,
        source_execution_status: result.rows[0].status,
        generated_at: new Date().toISOString(),
        build_payload: buildPayload.map((entry) => jsonOf(entry)),
        jobs: validatedJobs.map((entry) => jsonOf(entry)),
      }, null, 2)}\n`, { mode: 0o640 });
    }

    console.log(JSON.stringify({
      mode: 'read_only_replay',
      source_execution_id: result.rows[0].id,
      source_execution_status: result.rows[0].status,
      execution_error: {
        node: String(payload.resultData?.error?.node?.name || payload.resultData?.error?.node || ''),
        message: String(payload.resultData?.error?.message || ''),
        description: String(payload.resultData?.error?.description || ''),
      },
      source: {
        build_payload_items: buildPayload.length,
        livia_items: livia.length,
        image_upload_receipts: images.length,
        video_upload_receipts: videos.length,
        processed_videos: processedVideos.map((entry) => {
          const value = jsonOf(entry);
          const processing = value.media_processing && typeof value.media_processing === 'object'
            ? value.media_processing
            : {};
          return {
            source_file_id: String(value.source_file_id || ''),
            width: Number(processing.width || 0),
            height: Number(processing.height || 0),
            aspect_ratio: String(processing.aspect_ratio || ''),
            recommended_aspect_ratio: String(processing.recommended_aspect_ratio || ''),
            codec: String(processing.codec || ''),
            duration_seconds: Number(processing.duration_seconds || processing.duration || 0),
          };
        }),
        video_uploads: videos.map((entry) => {
          const value = jsonOf(entry);
          return {
            source_file_id: String(value.source_file_id || ''),
            video_id: String(value.video_id || ''),
            video_status: String(value.video_status || ''),
            ready: value.ready === true,
          };
        }),
        video_start_requests: persistedVideoStarts.map((entry) => {
          const value = jsonOf(entry);
          return {
            run_id: String(value.run_id || ''),
            source_file_id: String(value.source_file_id || ''),
            operation_key: String(value.gateway_request?.operation_key || ''),
          };
        }),
        video_start_responses: persistedVideoStartResponses.map((entry) => {
          const value = jsonOf(entry);
          const result = value.operation?.result && typeof value.operation.result === 'object' ? value.operation.result : {};
          return {
            operation_status: String(value.operation?.status || ''),
            replayed: value.replayed === true || value.operation?.replayed === true,
            video_id: String(result.video_id || result.id || ''),
          };
        }),
        video_ready_branch_counts: outputBranchCounts(runData, 'Video Ready?'),
      },
      planned_modes: plans.map((entry) => entry.json?.media_mode),
      envelopes: envelopes.map((entry) => ({
        media_mode: entry.json?.media_mode,
        expected: entry.json?.expected,
        completed: entry.json?.completed,
        skipped: entry.json?.skipped,
        ready: entry.json?.ready === true,
      })),
      assembly_count: assemblies.length,
      build_jobs_count: jobs.length,
      build_jobs_error_count: errors.length,
      replay_build_error: replayBuildError,
      replay_validation_error: replayValidationError,
      emitted_jobs_path: emittedJobsPath || null,
      validated_creative_count: validatedJobs.length,
      destination_count: new Set(jobs.map((entry) => entry.json?.destination_group).filter(Boolean)).size,
      replacement_decisions: jobs.map((entry) => ({
        action: entry.json?.action,
        match_status: entry.json?.match_status,
        offer_replacement_reason: entry.json?.offer_replacement_guard?.reason || '',
        offer_tag_present: Boolean(entry.json?.offer_replacement_guard?.expected_tag),
        destination_mode: entry.json?.destination_mode || '',
        destination_contract: entry.json?.destination_contract || {},
        cta_type: entry.json?.media_variant === 'video_single'
          ? entry.json?.creativePayload?.object_story_spec?.video_data?.call_to_action?.type || ''
          : entry.json?.creativePayload?.asset_feed_spec?.call_to_action_types?.[0] || '',
      })),
      ...(inspectMode ? {
        persisted_execution: {
          executed_nodes: Object.keys(runData),
          build_payloads: buildPayload.map((entry) => {
            const value = jsonOf(entry);
            const media = Array.isArray(value.media_inventory) ? value.media_inventory : [];
            return {
              job_key: String(value.job_key || ''),
              group_key: String(value.group_key || ''),
              media_mode: String(value.media_mode || ''),
              media: media.map((asset) => ({
                source_file_id: String(asset?.source_file_id || asset?.file_id || asset?.id || ''),
                name: String(asset?.name || asset?.file_name || ''),
                media_type: String(asset?.media_type || asset?.mime_type || ''),
                role: String(asset?.role || ''),
              })),
            };
          }),
          drive_finalization: persistedFinalization.map((entry) => {
            const value = jsonOf(entry);
            return {
              job_key: String(value.job_key || ''),
              group_key: String(value.group_key || ''),
              finalized_file_count: Array.isArray(value.finalized_files) ? value.finalized_files.length : 0,
              finalized_files: (Array.isArray(value.finalized_files) ? value.finalized_files : []).map((file) => ({
                source_file_id: String(file?.source_file_id || file?.file_id || file?.id || ''),
                name: String(file?.name || file?.file_name || ''),
                folder_id: String(file?.folder_id || file?.destination_folder_id || ''),
              })),
            };
          }),
          placement_checks: persistedPlacementChecks.map((entry) => {
            const targeting = entry && typeof entry.targeting === 'object' && entry.targeting ? entry.targeting : {};
            return {
              destination_group: String(entry.destination_group || ''),
              publisher_platforms: targeting.effective_publisher_platforms || targeting.publisher_platforms || [],
              facebook_positions: targeting.effective_facebook_positions || targeting.facebook_positions || [],
              instagram_positions: targeting.effective_instagram_positions || targeting.instagram_positions || [],
              audience_network_positions: targeting.effective_audience_network_positions || targeting.audience_network_positions || [],
              whatsapp_positions: targeting.effective_whatsapp_positions || targeting.whatsapp_positions || [],
            };
          }),
          build_jobs: persistedBuildJobs.map(creativeShape),
          validated_jobs: persistedValidated.map((entry) => ({
            ...creativeShape(entry),
            validation: jsonOf(entry).meta_creative_validation || {},
          })),
          advantage_readback: persistedAdvantageReadback.map((entry) => ({
            destination_group: String(jsonOf(entry).destination_group || ''),
            media_variant: String(jsonOf(entry).media_variant || ''),
            api_report: jsonOf(entry).advantage_plus_effective_report || {},
            mixed_media_readback: jsonOf(entry).mixed_media_readback || {},
          })),
          creative_responses: persistedCreativeResponses.map((entry) => {
            const value = jsonOf(entry);
            const errorValue = value.error && typeof value.error === 'object' ? value.error : {};
            const detailValue = value.detail && typeof value.detail === 'object'
              ? value.detail
              : (errorValue.detail && typeof errorValue.detail === 'object' ? errorValue.detail : errorValue);
            return {
              ok: value.ok === true,
              error: typeof value.error === 'string' ? value.error : String(errorValue.error || ''),
              detail: {
                message: String(detailValue.message || detailValue.error_user_msg || ''),
                classification: String(detailValue.classification || ''),
                code: Number(detailValue.code || 0),
                error_subcode: Number(detailValue.error_subcode || 0),
                retryable: detailValue.retryable === true,
              },
            };
          }),
        },
        replayed_jobs: jobs.map(creativeShape),
      } : {}),
      meta_mutations_performed: false,
    }, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

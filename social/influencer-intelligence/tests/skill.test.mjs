import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..', '..', '..', 'skills', 'skincos-influencer-intelligence');
const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const openai = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');

test('publishes a concise, triggerable Influencer Intelligence skill', () => {
  assert.match(skill, /^---\nname: skincos-influencer-intelligence\n/);
  assert.doesNotMatch(skill, /TODO|Structuring This Skill/);
  for (const trigger of ['analise @creator', 'esse influencer é bom?', 'compare estes influencers', 'qual creator devemos usar?', 'rank influencers para esta campanha', 'por que esse creator recebeu essa nota?']) {
    assert.match(skill, new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('requires MCP evidence, explicit states, confidence, coverage, and versioned score use', () => {
  for (const required of [
    'search_creators',
    'get_creator_profile',
    'get_creator_snapshots',
    'get_creator_media',
    'get_creator_analytics',
    'get_creator_score',
    'compare_creators',
    'observed',
    'derived',
    'inferred',
    'unavailable',
    'Confidence',
    'Data Coverage',
    'algorithm_version',
    'weights_version',
    'campaign fit',
  ]) {
    assert.match(skill, new RegExp(required, 'i'), `missing skill rule: ${required}`);
  }
  assert.match(skill, /Creator\nOverall Score\nConfidence\nData Coverage/);
  assert.match(skill, /followers[^\n]+scale context/i);
  assert.match(skill, /viral post as an outlier/i);
  assert.match(skill, /never call a creator or audience fraudulent/i);
});

test('keeps the skill read-only and prevents provider or secret bypasses', () => {
  assert.match(skill, /only the approved read-only MCP/i);
  for (const forbidden of ['Meta Graph', 'instagrapi', 'Instaloader', 'Apify', 'Modash', 'SQL/shell', 'follow, like, post, DM']) {
    assert.match(skill, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing boundary: ${forbidden}`);
  }
  assert.doesNotMatch(skill, /\b(?:fetch|axios|createServer|child_process|execute_workflow)\s*\(/i);
  assert.match(openai, /default_prompt: "Use \$skincos-influencer-intelligence/);
  assert.doesNotMatch(openai, /Use -influencer-intelligence/);
});

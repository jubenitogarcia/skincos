const { hash } = require('./canonical');

const DEPENDENCIES = {
  bass_timbre: ['bass', 'affected_sections', 'arrangement', 'mix', 'master', 'package'],
  chorus: ['harmony_chorus', 'melody_chorus', 'lyrics_chorus', 'stems_chorus', 'affected_sections', 'arrangement', 'mix', 'master', 'package'],
  loudness: ['master', 'package'],
  metadata: ['package'],
  constitution: ['candidates', 'composition_dna', 'animatic', 'stems', 'arrangement', 'mix', 'master', 'package'],
};
function invalidationPlan(change) { return DEPENDENCIES[change] ? [...DEPENDENCIES[change]] : ['manual_review']; }
function revisionOf(constitution, patch) {
  const next = { ...constitution, ...patch, revision: Number(constitution.revision || 0) + 1, lock_hash: '' };
  next.lock_hash = hash({ ...next, lock_hash: undefined });
  return next;
}
module.exports = { DEPENDENCIES, invalidationPlan, revisionOf };

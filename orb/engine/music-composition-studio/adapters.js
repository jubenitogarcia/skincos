const { validate } = require('./lib/contracts');

function organizerInput(payload) {
  const request = payload?.music_production_request || payload;
  validate('musicProductionRequest', request);
  return request;
}

function workflowOutput(musicPackage) {
  validate('musicPackage', musicPackage);
  return { package_id: `${musicPackage.production_id}:${musicPackage.composition_id}`, status: musicPackage.status, deliverables: musicPackage.deliverables, qa_reports: musicPackage.qa_reports, publish_requested: false };
}

module.exports = { organizerInput, workflowOutput };

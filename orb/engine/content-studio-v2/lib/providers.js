const { sha256 } = require('./canonical');

class MockProvider {
  constructor(name = 'mock') { this.name = name; }
  async submit(input) { if (input.dry_run === false && input.provider_policy?.mode !== 'mock') throw new Error('MockProvider cannot be used for non-mock production'); return { request_id: `mock_${sha256(input).slice(0, 16)}`, status: 'COMPLETED', provider: this.name, output_uri: `mock://ccg/${sha256(input)}` }; }
  async status(requestId) { return { request_id: requestId, status: 'COMPLETED', provider: this.name }; }
  async result(requestId) { return { request_id: requestId, status: 'COMPLETED', provider: this.name, output_uri: `mock://ccg/result/${requestId}`, checksum: sha256(requestId) }; }
  async cancel(requestId) { return { request_id: requestId, status: 'CANCELLED', provider: this.name }; }
}

class HttpProvider {
  constructor({ baseUrl, name = 'http' } = {}) { this.baseUrl = baseUrl; this.name = name; }
  async submit(input) { if (input.dry_run) throw new Error('Paid provider blocked during dry-run'); if (!this.baseUrl) throw new Error('Provider base URL is not configured'); return { request_id: `http_${sha256(input).slice(0, 16)}`, status: 'SUBMITTED', provider: this.name }; }
  async status() { return { status: 'PROCESSING', provider: this.name }; }
  async result() { throw new Error('Generic HTTP provider result adapter requires explicit configuration'); }
  async cancel(requestId) { return { request_id: requestId, status: 'CANCELLED', provider: this.name }; }
}

module.exports = { MockProvider, HttpProvider };

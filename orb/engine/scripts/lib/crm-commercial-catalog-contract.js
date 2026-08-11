'use strict';

// Shared endpoint contract for all workflow consumers. The CRM route remains
// local to the native Orb runtime, while the path and schema stay independent
// from any one campaign or ad channel.
const CRM_COMMERCIAL_CATALOG_BASE_URL = 'http://127.0.0.1:8099';
const CRM_COMMERCIAL_CATALOG_PATH = '/api/atendimento/internal/commercial/catalog';
const CRM_COMMERCIAL_CATALOG_URL = `${CRM_COMMERCIAL_CATALOG_BASE_URL}${CRM_COMMERCIAL_CATALOG_PATH}`;
const CRM_COMMERCIAL_CATALOG_UNIT_QUERY_URL = `${CRM_COMMERCIAL_CATALOG_URL}?unit={unit}`;
const CRM_COMMERCIAL_CATALOG_SCHEMA_VERSION = 'crm-commercial-catalog/v1';
const CRM_COMMERCIAL_CATALOG_TOOL_NAME = 'CRM Commercial Catalog';
const CRM_COMMERCIAL_CATALOG_TOOL_ID = 'crm-commercial-catalog';
const CRM_COMMERCIAL_CATALOG_UNITS = Object.freeze({
  bss: 'barra-shopping-sul',
  nh: 'novo-hamburgo',
});

module.exports = {
  CRM_COMMERCIAL_CATALOG_BASE_URL,
  CRM_COMMERCIAL_CATALOG_PATH,
  CRM_COMMERCIAL_CATALOG_URL,
  CRM_COMMERCIAL_CATALOG_UNIT_QUERY_URL,
  CRM_COMMERCIAL_CATALOG_SCHEMA_VERSION,
  CRM_COMMERCIAL_CATALOG_TOOL_NAME,
  CRM_COMMERCIAL_CATALOG_TOOL_ID,
  CRM_COMMERCIAL_CATALOG_UNITS,
};

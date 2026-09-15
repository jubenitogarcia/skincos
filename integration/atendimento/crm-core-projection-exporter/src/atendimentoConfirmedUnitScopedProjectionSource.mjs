import {
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
} from '../../../../shared/crm-auth/atendimentoCrmCoreProjectionSourceContract.js'

// Compatibility surface for existing Atendimento exporter callers. The
// immutable source descriptor is neutral shared contract code so CRM metadata
// preflight and the producer cannot drift across a direct module boundary.
export {
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
}

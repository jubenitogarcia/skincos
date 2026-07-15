import { evolutionOrchestrator } from './evolutionOrchestrator.js'

const CHANNELS = Object.freeze(Array.from({ length: 9 }, (_, index) => index + 1))
const PORTS = Object.freeze(CHANNELS.map((channel) => 3000 + channel))

function normalizeChannel(channelOrPort) {
  const value = Number.parseInt(String(channelOrPort), 10)
  if (Number.isInteger(value) && value >= 1 && value <= 9) return value
  if (Number.isInteger(value) && value >= 3001 && value <= 3009) return value - 3000
  throw new Error('INVALID_WHATSAPP_CHANNEL')
}

/**
 * Compatibility adapter for older CRM routes. All operations are delegated to
 * the single native WhatsApp engine; this module never spawns another runtime
 * or reads code, sessions or configuration from the repository.
 */
export const whatsappOrchestrator = {
  channelToPort(channel) {
    return 3000 + normalizeChannel(channel)
  },
  getAllChannels() {
    return [...CHANNELS]
  },
  getAllPorts() {
    return [...PORTS]
  },
  async getStatus() {
    return evolutionOrchestrator.getStatus()
  },
  getAvailableChannels() {
    return []
  },
  getFreeChannels() {
    return []
  },
  getRecoverySuggestions() {
    return null
  },
  getNextAvailableChannel() {
    return null
  },
  async startInstance(channelOrPort, options = {}) {
    return evolutionOrchestrator.startChannel(normalizeChannel(channelOrPort), options?.name)
  },
  async stopInstance(channelOrPort) {
    return evolutionOrchestrator.stopChannel(normalizeChannel(channelOrPort))
  },
  async restartInstance(channelOrPort) {
    return evolutionOrchestrator.restartChannel(normalizeChannel(channelOrPort))
  },
  async getInstanceStatus(channelOrPort) {
    return evolutionOrchestrator.getChannelStatus(normalizeChannel(channelOrPort))
  },
  async getInstanceQR(channelOrPort) {
    return evolutionOrchestrator.getChannelQR(normalizeChannel(channelOrPort))
  },
  async updateInstanceMetadata() {
    throw new Error('WHATSAPP_METADATA_UPDATE_UNSUPPORTED')
  },
  cleanup() {}
}

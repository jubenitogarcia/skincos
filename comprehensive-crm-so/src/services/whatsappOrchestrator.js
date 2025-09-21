// WhatsApp Orchestrator Service
// Manages multiple WhatsApp instances across ports 3001-3009
// Provides instance lifecycle management, status tracking, and port allocation

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INSTANCES_FILE = process.env.WA_INSTANCES_FILE || path.join(process.cwd(), 'whatsapp_instances.json')
const PORTS_RANGE = { min: 3001, max: 3009 } // 9 available channels
const WHATSAPP_MODULE_PATH = path.resolve(__dirname, '../../../whatsapp/official-module')

// Authentication configuration for Unified System communication
const CRM_UNIFIED_API_KEY = process.env.CRM_UNIFIED_API_KEY || 'unified-dev-key'
const UNIFIED_SYSTEM_URL = 'http://localhost:3001'

class WhatsAppOrchestrator {
  constructor() {
    this.instances = new Map()
    this.saveTimer = null
    this.portLocks = new Map() // Port-based locking for concurrency control
    // Remove automatic port initialization - instances are created only on explicit request
    this.loadInstances()
  }

  // Helper method to determine if we should use authentication for a given port
  shouldUseAuthentication(port) {
    // Only channel 1 (port 3001) uses the Unified System with authentication
    return port === 3001
  }

  // Helper method to create authenticated fetch requests to Unified System
  async fetchUnifiedSystem(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': CRM_UNIFIED_API_KEY,
      ...options.headers
    }

    const fetchOptions = {
      ...options,
      headers
    }

    console.log(`[WhatsApp Orchestrator] Making authenticated request to: ${url}`)
    return fetch(url, fetchOptions)
  }

  // Smart fetch method that automatically chooses authentication based on port
  async smartFetch(port, endpoint, options = {}) {
    const url = `http://localhost:${port}${endpoint}`

    if (this.shouldUseAuthentication(port)) {
      return this.fetchUnifiedSystem(url, options)
    } else {
      return fetch(url, options)
    }
  }

  // Channel-to-port mapping utility methods
  channelToPort(channel) {
    if (typeof channel !== 'number' || channel < 1 || channel > 9) {
      throw new Error(`Invalid channel: ${channel}. Must be between 1 and 9.`)
    }
    return PORTS_RANGE.min + (channel - 1) // Channel 1 = port 3001, Channel 2 = port 3002, etc.
  }

  portToChannel(port) {
    if (typeof port !== 'number' || port < PORTS_RANGE.min || port > PORTS_RANGE.max) {
      throw new Error(`Invalid port: ${port}. Must be between ${PORTS_RANGE.min} and ${PORTS_RANGE.max}.`)
    }
    return port - PORTS_RANGE.min + 1 // Port 3001 = channel 1, Port 3002 = channel 2, etc.
  }

  // Get all valid channels (1-9)
  getAllChannels() {
    return Array.from({ length: 9 }, (_, i) => i + 1)
  }

  // Get all valid ports (3001-3009)
  getAllPorts() {
    return Array.from({ length: 9 }, (_, i) => PORTS_RANGE.min + i)
  }

  // Create instance record only when needed (no global instances)
  createInstanceRecord(port, options = {}) {
    if (this.instances.has(port)) {
      return this.instances.get(port)
    }

    const channel = this.portToChannel(port)
    const instance = {
      id: `wa-channel-${channel}`,
      channel,
      port,
      status: 'free',
      createdAt: new Date(),
      updatedAt: new Date(),
      name: options.name || `WhatsApp Channel ${channel}`,
      metadata: {
        errorCount: 0,
        restartCount: 0,
        ...options.metadata
      }
    }

    this.instances.set(port, instance)
    this.scheduleSave()
    return instance
  }

  async loadInstances() {
    try {
      const raw = await fs.readFile(INSTANCES_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (data && Array.isArray(data.instances)) {
        data.instances.forEach((inst) => {
          if (inst.port >= PORTS_RANGE.min && inst.port <= PORTS_RANGE.max) {
            const instance = {
              ...inst,
              channel: inst.channel || this.portToChannel(inst.port), // Ensure channel mapping
              createdAt: new Date(inst.createdAt),
              updatedAt: new Date(inst.updatedAt),
              status: ['connected', 'starting', 'qr_pending'].includes(inst.status) ? 'free' : inst.status, // Reset running instances on restart
              process: undefined, // Don't restore process references
              qr: undefined, // Don't restore QR codes
              metadata: {
                errorCount: 0,
                restartCount: 0,
                ...inst.metadata
              }
            }
            this.instances.set(inst.port, instance)
          }
        })
      }
    } catch (error) {
      console.warn('[WhatsApp Orchestrator] Could not load instances file:', error)
    }
  }

  async saveInstances() {
    const instancesArray = Array.from(this.instances.values()).map(inst => ({
      ...inst,
      process: undefined // Don't serialize process references
    }))

    try {
      await fs.writeFile(INSTANCES_FILE, JSON.stringify({
        instances: instancesArray,
        lastUpdate: new Date().toISOString()
      }, null, 2))
    } catch (error) {
      console.error('[WhatsApp Orchestrator] Failed to save instances:', error)
    }
  }

  // Security helper to sanitize log output
  sanitizeLogOutput(output) {
    if (output.includes('QR RECEIVED')) {
      // Redact QR tokens while preserving state information
      return output.replace(/QR RECEIVED .+/, 'QR RECEIVED [REDACTED_FOR_SECURITY]')
    }
    return output
  }

  // Port locking for concurrency control
  async acquirePortLock(port) {
    const lockKey = `port-${port}`
    while (this.portLocks.get(lockKey)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    this.portLocks.set(lockKey, true)
  }

  releasePortLock(port) {
    const lockKey = `port-${port}`
    this.portLocks.delete(lockKey)
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveInstances(), 1000)
  }

  getStatus() {
    const instances = Array.from(this.instances.values())
    const allChannels = this.getAllChannels()
    const channelStatus = allChannels.map(channel => {
      const port = this.channelToPort(channel)
      const instance = this.instances.get(port)

      if (instance) {
        return { ...this.serializeInstance(instance) }
      } else {
        // Channel is available - no instance created yet
        return {
          id: `wa-channel-${channel}`,
          channel,
          port,
          status: 'available',
          name: `WhatsApp Channel ${channel}`,
          createdAt: null,
          updatedAt: null
        }
      }
    })

    return {
      totalChannels: allChannels.length,
      availableChannels: channelStatus.filter(i => i.status === 'available').length,
      freeInstances: instances.filter(i => i.status === 'free').length,
      connectedInstances: instances.filter(i => i.status === 'connected').length,
      errorInstances: instances.filter(i => i.status === 'error').length,
      startingInstances: instances.filter(i => i.status === 'starting').length,
      channels: channelStatus
    }
  }

  // API serialization helper - strips non-JSON-serializable fields like ChildProcess
  serializeInstances(instances) {
    return instances.map(inst => ({
      ...inst,
      process: undefined, // Strip ChildProcess reference
      qr: inst.qr ? '[QR_AVAILABLE]' : undefined // Hide QR in general status calls
    }))
  }

  serializeInstance(instance) {
    if (!instance) return null
    return {
      ...instance,
      process: undefined, // Strip ChildProcess reference
      qr: instance.qr ? '[QR_AVAILABLE]' : undefined // Hide actual QR in serialization
    }
  }

  // Get instance by channel number
  getInstanceByChannel(channel) {
    try {
      const port = this.channelToPort(channel)
      return this.instances.get(port) || null
    } catch (error) {
      return null
    }
  }

  // ROBUSTNESS FIX: Proper readiness polling instead of fixed delays
  async waitForInstanceReadiness(port, timeoutMs = 30000) {
    const instance = this.instances.get(port)
    if (!instance) {
      return { success: false, error: 'Instance not found' }
    }

    const startTime = Date.now()
    const pollInterval = 1000 // Poll every 1 second

    while (Date.now() - startTime < timeoutMs) {
      // First check if the process is still alive
      if (!instance.process || instance.process.killed) {
        return { success: false, error: 'Process died during startup' }
      }

      // Try to poll the instance health endpoint
      try {
        // TIMEOUT FIX: Use AbortController instead of unsupported timeout parameter
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000) // 3 second timeout

        const response = await this.smartFetch(port, '/api/status', {
          method: 'GET',
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          const data = await response.json()
          // Instance is ready if it responds with any valid status
          if (data && typeof data === 'object') {
            console.log(`[WhatsApp Orchestrator] Instance on port ${port} is ready with status: ${data.status || 'unknown'}`)
            return { success: true, status: data.status }
          }
        }
      } catch (error) {
        // Connection refused is expected during startup, continue polling
        // Only log non-connection errors and non-abort errors
        if (!error.message?.includes('ECONNREFUSED') &&
          !error.message?.includes('fetch failed') &&
          error.name !== 'AbortError') {
          console.log(`[WhatsApp Orchestrator] Readiness check error for port ${port}: ${error.message}`)
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    return { success: false, error: `Instance startup timed out after ${timeoutMs}ms` }
  }

  getFreePort() {
    // First check for existing free instances
    const freeInstance = Array.from(this.instances.values())
      .find(inst => inst.status === 'free')
    if (freeInstance) {
      return freeInstance.port
    }

    // If no free instances, return the first available channel
    const availableChannel = this.getAvailableChannel()
    return availableChannel ? this.channelToPort(availableChannel) : null
  }

  // Get the first available channel (no instance created yet)
  getAvailableChannel() {
    const allChannels = this.getAllChannels()
    for (const channel of allChannels) {
      const port = this.channelToPort(channel)
      if (!this.instances.has(port)) {
        return channel
      }
    }
    return null
  }

  // Get all available channels (no instances created)
  getAvailableChannels() {
    const allChannels = this.getAllChannels()
    return allChannels.filter(channel => {
      const port = this.channelToPort(channel)
      return !this.instances.has(port)
    })
  }

  // Get free channels (instances exist but are free)
  getFreeChannels() {
    return Array.from(this.instances.values())
      .filter(inst => inst.status === 'free')
      .map(inst => inst.channel)
      .sort((a, b) => a - b)
  }

  // Get next available channel (prioritize available over free)
  getNextAvailableChannel() {
    const available = this.getAvailableChannel()
    if (available) return available

    const freeChannels = this.getFreeChannels()
    return freeChannels.length > 0 ? freeChannels[0] : null
  }

  // Get next available port (prioritize available over free)
  getNextFreePort() {
    const channel = this.getNextAvailableChannel()
    return channel ? this.channelToPort(channel) : null
  }

  // Get all available ports (both available channels and free instances)
  getAllFreePorts() {
    const availableChannels = this.getAvailableChannels()
    const freeChannels = this.getFreeChannels()

    return [...availableChannels, ...freeChannels]
      .sort((a, b) => a - b)
      .map(channel => this.channelToPort(channel))
  }

  // CHANNEL RECOVERY SUGGESTIONS: Get recovery suggestions for channels
  getRecoverySuggestions() {
    const erroredChannels = Array.from(this.instances.values())
      .filter(inst => inst.status === 'error')
      .sort((a, b) => a.channel - b.channel)

    const staleChannels = Array.from(this.instances.values())
      .filter(inst => {
        const hoursSinceUpdate = (Date.now() - new Date(inst.updatedAt).getTime()) / (1000 * 60 * 60)
        return (inst.status === 'qr_pending' || inst.status === 'starting') && hoursSinceUpdate > 1
      })
      .sort((a, b) => a.channel - b.channel)

    return {
      erroredChannels: erroredChannels.map(inst => ({
        channel: inst.channel,
        port: inst.port,
        status: inst.status,
        errorCount: inst.metadata?.errorCount || 0,
        lastError: inst.metadata?.lastError,
        lastUpdated: inst.updatedAt
      })),
      staleChannels: staleChannels.map(inst => ({
        channel: inst.channel,
        port: inst.port,
        status: inst.status,
        hoursSinceUpdate: Math.round((Date.now() - new Date(inst.updatedAt).getTime()) / (1000 * 60 * 60)),
        lastUpdated: inst.updatedAt
      }))
    }
  }

  getInstanceByPort(port) {
    return this.instances.get(port) || null
  }

  async startInstance(channelOrPort, options = {}) {
    let targetPort, targetChannel

    // Handle both channel numbers (1-9) and port numbers (3001-3009)
    if (typeof channelOrPort === 'number') {
      if (channelOrPort >= 1 && channelOrPort <= 9) {
        // Channel number provided
        targetChannel = channelOrPort
        targetPort = this.channelToPort(targetChannel)
      } else if (channelOrPort >= PORTS_RANGE.min && channelOrPort <= PORTS_RANGE.max) {
        // Port number provided
        targetPort = channelOrPort
        targetChannel = this.portToChannel(targetPort)
      } else {
        return {
          success: false,
          error: `Invalid channel/port: ${channelOrPort}. Use channel 1-9 or port ${PORTS_RANGE.min}-${PORTS_RANGE.max}`
        }
      }
    } else if (!channelOrPort) {
      // Auto-select next available
      targetChannel = this.getNextAvailableChannel()
      if (!targetChannel) {
        const recoverySuggestions = this.getRecoverySuggestions()
        const hasRecoveryOptions = recoverySuggestions.erroredChannels.length > 0 || recoverySuggestions.staleChannels.length > 0

        return {
          success: false,
          error: 'No available channels',
          suggestions: {
            type: 'no_free_channels',
            availableChannels: this.getAvailableChannels(),
            freeChannels: this.getFreeChannels(),
            recoverySuggestions: hasRecoveryOptions ? recoverySuggestions : null,
            message: hasRecoveryOptions
              ? 'Nenhum canal disponível. Considere parar ou reiniciar instâncias com erro.'
              : 'Todos os canais estão ocupados. Aguarde ou pare uma instância ativa.'
          }
        }
      }
      targetPort = this.channelToPort(targetChannel)
    } else {
      return { success: false, error: 'Invalid channel/port parameter' }
    }

    // Get or create instance record
    let instance = this.instances.get(targetPort)
    if (!instance) {
      // Create new instance record for the channel
      instance = this.createInstanceRecord(targetPort, {
        name: options.name || `WhatsApp Channel ${targetChannel}`
      })
    }

    // CONCURRENCY FIX: Acquire port lock to prevent race conditions
    await this.acquirePortLock(targetPort)

    try {
      // If this is Channel 1 and UNIFIED_MODE is enabled, always forward to unified system
      if (targetChannel === 1 && process.env.UNIFIED_MODE === 'true') {
        console.log(`[WhatsApp Orchestrator] Forwarding Channel 1 start request to unified system`)
        try {
          const response = await this.fetchUnifiedSystem(`${UNIFIED_SYSTEM_URL}/whatsapp/1/status`, {
            method: 'GET'
          })

          if (response.ok) {
            const data = await response.json()
            console.log(`[WhatsApp Orchestrator] Unified system response:`, data)
            return {
              success: true,
              channel: targetChannel,
              port: targetPort,
              forwardedToUnified: true,
              unifiedResponse: data,
              message: 'Request forwarded to WhatsApp Unified System'
            }
          } else {
            const errorData = await response.json().catch(() => ({}))
            console.error(`[WhatsApp Orchestrator] Unified system error:`, response.status, errorData)
            return {
              success: false,
              error: `Unified system error: ${response.status} ${response.statusText}`,
              channel: targetChannel,
              port: targetPort,
              unifiedError: errorData
            }
          }
        } catch (error) {
          console.error(`[WhatsApp Orchestrator] Failed to connect to unified system:`, error)
          return {
            success: false,
            error: `Failed to connect to unified system: ${error.message}`,
            channel: targetChannel,
            port: targetPort,
            suggestions: {
              type: 'unified_connection_error',
              message: 'Make sure WhatsApp Unified System is running on port 3001'
            }
          }
        }
      }

      // Check if instance is disabled (for non-Channel-1 or non-unified mode)
      if (instance.status === 'disabled' || instance.metadata?.disabled) {
        const disabledReason = instance.metadata?.disabledReason || 'Instance disabled'
        return {
          success: false,
          error: `Channel ${targetChannel} is disabled and cannot be started: ${disabledReason}`,
          suggestions: {
            type: 'disabled_channel',
            message: 'Use the unified multi-channel system instead',
            nextAvailableChannel: null,
            availableChannels: [],
            freeChannels: []
          },
          channel: targetChannel,
          port: targetPort
        }
      }

      if (instance.status !== 'free' && instance.status !== 'available') {
        // ALTERNATIVE CHANNEL SUGGESTIONS: When target channel is busy, suggest next available
        const nextAvailableChannel = this.getNextAvailableChannel()
        const availableChannels = this.getAvailableChannels()
        const freeChannels = this.getFreeChannels()

        return {
          success: false,
          error: `Channel ${targetChannel} is not available (status: ${instance.status})`,
          suggestions: {
            type: 'channel_occupied',
            targetChannel,
            targetPort,
            currentStatus: instance.status,
            nextAvailableChannel,
            availableChannels,
            freeChannels,
            message: nextAvailableChannel
              ? `Canal ${targetChannel} ocupado — iniciar no canal ${nextAvailableChannel}?`
              : 'Canal ocupado e nenhum canal livre disponível'
          }
        }
      }
      // Update instance status
      instance.status = 'starting'
      instance.updatedAt = new Date()
      if (options?.name) instance.name = options.name
      instance.metadata = {
        ...instance.metadata,
        startedAt: new Date().toISOString(),
        restartCount: (instance.metadata?.restartCount || 0) + 1,
        explicitStart: true // Mark as explicitly started by user
      }

      console.log(`[WhatsApp Orchestrator] Starting instance on Channel ${targetChannel} (Port ${targetPort}) with name: ${instance.name}`)

      // Start WhatsApp process
      const env = {
        ...process.env,
        WHATSAPP_PORT: targetPort.toString(),
        NODE_ENV: 'production'
      }

      const child = spawn('node', ['official-whatsapp.js'], {
        cwd: WHATSAPP_MODULE_PATH,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      instance.process = child

      // Handle process events
      child.on('error', (error) => {
        console.error(`[WhatsApp Orchestrator] Process error for port ${targetPort}:`, error)
        instance.status = 'error'
        instance.metadata = {
          ...instance.metadata,
          errorCount: (instance.metadata?.errorCount || 0) + 1
        }
        instance.updatedAt = new Date()
        this.scheduleSave()
      })

      child.on('exit', (code, signal) => {
        console.log(`[WhatsApp Orchestrator] Process exited for port ${targetPort}. Code: ${code}, Signal: ${signal}`)
        if (instance.status !== 'stopping') {
          instance.status = 'error'
          instance.metadata = {
            ...instance.metadata,
            errorCount: (instance.metadata?.errorCount || 0) + 1
          }
        } else {
          instance.status = 'free'
        }
        instance.process = undefined
        instance.updatedAt = new Date()
        this.scheduleSave()
      })

      child.stdout?.on('data', (data) => {
        const output = data.toString()

        // SECURITY FIX: Sanitize QR output - redact sensitive tokens while preserving state
        const sanitizedOutput = this.sanitizeLogOutput(output)
        console.log(`[WhatsApp ${targetPort}] ${sanitizedOutput}`)

        // Monitor for status changes
        if (output.includes('QR RECEIVED')) {
          instance.status = 'qr_pending'
          // Extract QR from output if available - but don't log it
          const qrMatch = output.match(/QR RECEIVED (.+)/)
          if (qrMatch) {
            instance.qr = qrMatch[1]
            console.log(`[WhatsApp ${targetPort}] QR Code generated (${qrMatch[1].length} chars) - ready for scanning`)
          }
          instance.updatedAt = new Date()
          this.scheduleSave()
        } else if (output.includes('AUTHENTICATED') || output.includes('READY')) {
          instance.status = 'connected'
          instance.qr = undefined
          instance.updatedAt = new Date()
          this.scheduleSave()
        }
      })

      child.stderr?.on('data', (data) => {
        console.error(`[WhatsApp ${targetPort} ERROR] ${data.toString()}`)
      })

      this.scheduleSave()

      // ROBUSTNESS FIX: Replace fixed delay with proper readiness polling
      const readinessResult = await this.waitForInstanceReadiness(targetPort, 30000) // 30s timeout

      if (readinessResult.success) {
        return { success: true, instance: this.serializeInstance(instance) }
      } else {
        instance.status = 'error'
        instance.metadata = {
          ...instance.metadata,
          errorCount: (instance.metadata?.errorCount || 0) + 1,
          lastError: readinessResult.error,
          lastErrorAt: new Date().toISOString()
        }
        instance.updatedAt = new Date()
        this.scheduleSave()
        // ALTERNATIVE CHANNEL SUGGESTIONS: When startup fails, suggest alternatives if available
        const nextAvailableChannel = this.getNextAvailableChannel()
        const availableChannels = this.getAvailableChannels()
        const freeChannels = this.getFreeChannels()

        return {
          success: false,
          error: readinessResult.error || 'Instance failed to become ready',
          suggestions: nextAvailableChannel ? {
            type: 'startup_failed',
            failedChannel: targetChannel,
            nextAvailableChannel,
            availableChannels,
            freeChannels,
            message: `Falha ao iniciar no canal ${targetChannel}. Tentar canal ${nextAvailableChannel}?`
          } : null
        }
      }

    } catch (error) {
      instance.status = 'error'
      instance.metadata = {
        ...instance.metadata,
        errorCount: (instance.metadata?.errorCount || 0) + 1
      }
      instance.updatedAt = new Date()
      this.scheduleSave()

      // ALTERNATIVE CHANNEL SUGGESTIONS: When startup exception occurs, suggest alternatives
      const nextAvailableChannel = this.getNextAvailableChannel()
      const availableChannels = this.getAvailableChannels()
      const freeChannels = this.getFreeChannels()

      return {
        success: false,
        error: error.message,
        suggestions: nextAvailableChannel ? {
          type: 'startup_error',
          failedChannel: targetChannel,
          nextAvailableChannel,
          availableChannels,
          freeChannels,
          message: `Erro ao iniciar no canal ${targetChannel}. Tentar canal ${nextAvailableChannel}?`
        } : null
      }
    } finally {
      // Always release the port lock
      this.releasePortLock(targetPort)
    }
  }

  async stopInstance(channelOrPort) {
    let port, channel

    // Handle both channel numbers and port numbers
    if (typeof channelOrPort === 'number') {
      if (channelOrPort >= 1 && channelOrPort <= 9) {
        channel = channelOrPort
        port = this.channelToPort(channel)
      } else if (channelOrPort >= PORTS_RANGE.min && channelOrPort <= PORTS_RANGE.max) {
        port = channelOrPort
        channel = this.portToChannel(port)
      } else {
        return {
          success: false,
          error: `Invalid channel/port: ${channelOrPort}. Use channel 1-9 or port ${PORTS_RANGE.min}-${PORTS_RANGE.max}`
        }
      }
    } else {
      return { success: false, error: 'Channel or port number required' }
    }

    const instance = this.instances.get(port)
    if (!instance) {
      return {
        success: true,
        channel,
        port,
        message: 'No instance to stop - channel is available'
      }
    }

    if (instance.status === 'free' || instance.status === 'available') {
      return { success: true, channel, port, message: 'Instance already stopped' }
    }

    console.log(`[WhatsApp Orchestrator] Stopping channel ${channel} (status: ${instance.status})...`)

    // CONCURRENCY FIX: Acquire port lock
    await this.acquirePortLock(port)

    try {
      instance.status = 'stopping'
      instance.updatedAt = new Date()
      instance.metadata = {
        ...instance.metadata,
        stoppedAt: new Date().toISOString()
      }

      if (instance.process && !instance.process.killed) {
        // First try graceful shutdown with SIGTERM
        console.log(`[WhatsApp Orchestrator] Sending SIGTERM to channel ${channel} process...`)
        instance.process.kill('SIGTERM')

        // Wait for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 5000))

        // Force kill if still running
        if (instance.process && !instance.process.killed) {
          console.log(`[WhatsApp Orchestrator] Force killing channel ${channel} process...`)
          instance.process.kill('SIGKILL')

          // Wait a bit more for force kill to take effect
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      instance.status = 'free'
      instance.process = undefined
      instance.qr = undefined
      instance.updatedAt = new Date()
      this.scheduleSave()

      console.log(`[WhatsApp Orchestrator] Channel ${channel} stopped successfully`)
      return { success: true, channel, port }
    } catch (error) {
      console.error(`[WhatsApp Orchestrator] Error stopping channel ${channel}:`, error)
      return { success: false, error: error.message, channel, port }
    } finally {
      // Always release the port lock
      this.releasePortLock(port)
    }
  }

  async getInstanceQR(channelOrPort) {
    let port, channel

    // Handle both channel numbers and port numbers
    if (typeof channelOrPort === 'number') {
      if (channelOrPort >= 1 && channelOrPort <= 9) {
        channel = channelOrPort
        port = this.channelToPort(channel)
      } else if (channelOrPort >= PORTS_RANGE.min && channelOrPort <= PORTS_RANGE.max) {
        port = channelOrPort
        channel = this.portToChannel(port)
      } else {
        return {
          error: `Invalid channel/port: ${channelOrPort}. Use channel 1-9 or port ${PORTS_RANGE.min}-${PORTS_RANGE.max}`
        }
      }
    } else {
      return { error: 'Channel or port number required' }
    }

    const instance = this.instances.get(port)
    if (!instance) {
      return {
        error: `No instance on channel ${channel}`,
        channel,
        port,
        suggestion: 'Start the instance first to generate QR code'
      }
    }

    // If we have a cached QR and status is appropriate, return it
    if (instance.qr && instance.status === 'qr_pending') {
      return {
        qr: instance.qr,
        status: instance.status,
        channel,
        port,
        cached: true
      }
    }

    // Try to fetch QR from the instance API with improved error handling
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout for QR fetch

      // Use fetchUnifiedSystem directly for port 3001 to ensure authentication
      const response = port === 3001
        ? await this.fetchUnifiedSystem(`${UNIFIED_SYSTEM_URL}/api/qr`, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'WhatsApp-Orchestrator/1.0'
          }
        })
        : await this.smartFetch(port, '/api/qr', {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'WhatsApp-Orchestrator/1.0'
          }
        })
      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        if (data.qr) {
          instance.qr = data.qr
          instance.status = 'qr_pending'
          instance.metadata = {
            ...instance.metadata,
            qrGeneratedAt: new Date().toISOString(),
            qrAttempts: (instance.metadata?.qrAttempts || 0) + 1
          }
          instance.updatedAt = new Date()
          this.scheduleSave()

          console.log(`[WhatsApp Orchestrator] QR generated for channel ${channel} (attempt ${instance.metadata.qrAttempts})`)

          return {
            qr: data.qr,
            status: instance.status,
            channel,
            port,
            cached: false,
            generated: true
          }
        } else if (data.status) {
          // Instance responded but no QR available
          return {
            status: data.status || instance.status,
            channel,
            port,
            message: data.message || 'No QR available in current state'
          }
        }
      } else {
        console.warn(`[WhatsApp Orchestrator] HTTP ${response.status} when fetching QR for channel ${channel}`)
        return {
          status: instance.status,
          channel,
          port,
          error: `HTTP ${response.status} from instance`
        }
      }
    } catch (error) {
      const isTimeoutError = error.name === 'AbortError'
      const isConnectionError = error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')

      if (!isConnectionError && !isTimeoutError) {
        console.error(`[WhatsApp Orchestrator] Error fetching QR for channel ${channel}:`, error.message)
      }

      return {
        status: instance.status,
        channel,
        port,
        error: isTimeoutError ? 'QR fetch timeout' : isConnectionError ? 'Instance not responding' : 'QR fetch failed'
      }
    }

    return {
      status: instance.status,
      channel,
      port,
      message: 'QR not available in current state'
    }
  }

  async getInstanceStatus(channelOrPort) {
    let port, channel

    // Handle both channel numbers and port numbers
    if (typeof channelOrPort === 'number') {
      if (channelOrPort >= 1 && channelOrPort <= 9) {
        channel = channelOrPort
        port = this.channelToPort(channel)
      } else if (channelOrPort >= PORTS_RANGE.min && channelOrPort <= PORTS_RANGE.max) {
        port = channelOrPort
        channel = this.portToChannel(port)
      } else {
        return {
          error: `Invalid channel/port: ${channelOrPort}. Use channel 1-9 or port ${PORTS_RANGE.min}-${PORTS_RANGE.max}`
        }
      }
    } else {
      return { error: 'Channel or port number required' }
    }

    const instance = this.instances.get(port)
    if (!instance) {
      // Channel/port exists but no instance created yet
      return {
        status: 'available',
        channel,
        port,
        instance: {
          id: `wa-channel-${channel}`,
          channel,
          port,
          status: 'available',
          name: `WhatsApp Channel ${channel}`,
          createdAt: null,
          updatedAt: null
        }
      }
    }

    // IMPROVED ERROR HANDLING: Better endpoint validation and error categorization
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000) // Longer timeout for better reliability

      const response = await this.smartFetch(port, '/api/status', {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'WhatsApp-Orchestrator/1.0'
        }
      })
      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()

        // Update our internal status based on live data with better mapping
        const statusMapping = {
          'ready': 'connected',
          'authenticated': 'connected',
          'qr_received': 'qr_pending',
          'loading': 'starting',
          'disconnected': 'error',
          'auth_failure': 'error'
        }

        const mappedStatus = statusMapping[data.status] || instance.status

        if (mappedStatus === 'connected' && instance.status !== 'connected') {
          instance.status = 'connected'
          instance.qr = undefined
          instance.metadata = {
            ...instance.metadata,
            phoneNumber: data.clientInfo?.wid?.user,
            clientInfo: data.clientInfo,
            lastActivity: new Date(),
            connectedAt: new Date().toISOString()
          }
          instance.updatedAt = new Date()
          this.scheduleSave()
          console.log(`[WhatsApp Orchestrator] Channel ${channel} connected successfully`)
        } else if (mappedStatus === 'qr_pending' && data.hasQR) {
          instance.status = 'qr_pending'
          instance.updatedAt = new Date()
          this.scheduleSave()
        }

        // Return comprehensive status information
        return {
          status: instance.status,
          channel,
          port,
          instance: this.serializeInstance(instance),
          liveData: {
            status: data.status,
            hasQR: data.hasQR,
            clientInfo: data.clientInfo,
            isReady: data.status === 'ready'
          }
        }
      } else {
        // HTTP error - categorize and handle appropriately
        const errorCategory = response.status >= 500 ? 'server_error' : 'client_error'
        console.warn(`[WhatsApp Orchestrator] HTTP ${response.status} from channel ${channel} (${errorCategory}) - keeping current status`)

        return {
          status: instance.status,
          channel,
          port,
          instance: this.serializeInstance(instance),
          warning: `HTTP ${response.status} response from instance`
        }
      }
    } catch (error) {
      // ENHANCED ERROR CATEGORIZATION: Better error handling with detailed categorization
      const errorCategories = {
        'AbortError': 'timeout',
        'ECONNREFUSED': 'connection_refused',
        'ENOTFOUND': 'dns_error',
        'fetch failed': 'network_error',
        'TypeError': 'protocol_error'
      }

      let errorCategory = 'unknown_error'
      for (const [errorType, category] of Object.entries(errorCategories)) {
        if (error.name === errorType || error.message?.includes(errorType)) {
          errorCategory = category
          break
        }
      }

      // Log detailed error information for debugging
      if (errorCategory !== 'connection_refused' && errorCategory !== 'timeout') {
        console.error(`[WhatsApp Orchestrator] ${errorCategory} checking channel ${channel}:`, error.message)
      }

      // Conservative error state management - only mark as error if process is definitively dead
      if ((instance.status === 'connected' || instance.status === 'qr_pending') &&
        (!instance.process || instance.process.killed) &&
        errorCategory === 'connection_refused') {
        console.warn(`[WhatsApp Orchestrator] Channel ${channel} process appears dead, marking as error`)
        instance.status = 'error'
        instance.metadata = {
          ...instance.metadata,
          errorCount: (instance.metadata?.errorCount || 0) + 1,
          lastError: `Process died (${errorCategory})`,
          lastErrorAt: new Date().toISOString()
        }
        instance.updatedAt = new Date()
        this.scheduleSave()
      }

      return {
        status: instance.status,
        channel,
        port,
        instance: this.serializeInstance(instance),
        error: errorCategory,
        errorMessage: error.message
      }
    }
  }

  async updateInstanceMetadata(channelOrPort, metadata) {
    let port, channel

    // Handle both channel numbers and port numbers
    if (typeof channelOrPort === 'number') {
      if (channelOrPort >= 1 && channelOrPort <= 9) {
        channel = channelOrPort
        port = this.channelToPort(channel)
      } else if (channelOrPort >= PORTS_RANGE.min && channelOrPort <= PORTS_RANGE.max) {
        port = channelOrPort
        channel = this.portToChannel(port)
      } else {
        return {
          success: false,
          error: `Invalid channel/port: ${channelOrPort}. Use channel 1-9 or port ${PORTS_RANGE.min}-${PORTS_RANGE.max}`
        }
      }
    } else {
      return { success: false, error: 'Channel or port number required' }
    }

    const instance = this.instances.get(port)
    if (!instance) {
      return {
        success: false,
        error: `No instance on channel ${channel}`,
        suggestion: 'Create an instance first by starting it'
      }
    }

    instance.metadata = {
      ...instance.metadata,
      ...metadata
    }
    instance.updatedAt = new Date()
    this.scheduleSave()

    console.log(`[WhatsApp Orchestrator] Updated metadata for channel ${channel}:`, metadata)
    return { success: true, channel, port }
  }

  async restartInstance(channelOrPort) {
    let port, channel

    // Handle both channel numbers and port numbers
    if (typeof channelOrPort === 'number') {
      if (channelOrPort >= 1 && channelOrPort <= 9) {
        channel = channelOrPort
        port = this.channelToPort(channel)
      } else if (channelOrPort >= PORTS_RANGE.min && channelOrPort <= PORTS_RANGE.max) {
        port = channelOrPort
        channel = this.portToChannel(port)
      } else {
        return {
          success: false,
          error: `Invalid channel/port: ${channelOrPort}. Use channel 1-9 or port ${PORTS_RANGE.min}-${PORTS_RANGE.max}`
        }
      }
    } else {
      return { success: false, error: 'Channel or port number required' }
    }

    console.log(`[WhatsApp Orchestrator] Restarting channel ${channel}...`)

    const stopResult = await this.stopInstance(port)
    if (!stopResult.success) {
      return { ...stopResult, channel, port }
    }

    // Wait longer for proper cleanup
    await new Promise(resolve => setTimeout(resolve, 3000))

    const startResult = await this.startInstance(port)
    return { ...startResult, channel, port }
  }

  async cleanup() {
    // Stop all running instances
    const instances = Array.from(this.instances.values())
    for (const instance of instances) {
      if (instance.status !== 'free' && instance.process) {
        await this.stopInstance(instance.port)
      }
    }
  }
}

// Export singleton instance
export const whatsappOrchestrator = new WhatsAppOrchestrator()

// Graceful shutdown
process.on('SIGTERM', () => whatsappOrchestrator.cleanup())
process.on('SIGINT', () => whatsappOrchestrator.cleanup())

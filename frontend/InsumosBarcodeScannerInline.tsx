import React from 'react'
import { Button } from '@/button'

export function InsumosBarcodeScannerInline({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void
  onClose: () => void
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const zxingReaderRef = React.useRef<any>(null)
  const zxingControlsRef = React.useRef<any>(null)
  const runTokenRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const [error, setError] = React.useState<string | null>(null)
  const [supported, setSupported] = React.useState(true)
  const [starting, setStarting] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [needsGesture, setNeedsGesture] = React.useState(false)
  const [mode, setMode] = React.useState<'BARCODE_DETECTOR' | 'ZXING' | 'NONE'>('BARCODE_DETECTOR')
  const [facingMode, setFacingMode] = React.useState<'user' | 'environment'>('environment')
  const [activeFacingMode, setActiveFacingMode] = React.useState<'user' | 'environment' | null>(null)

  const stop = React.useCallback(() => {
    runTokenRef.current += 1
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    try {
      zxingControlsRef.current?.stop?.()
    } catch {
      // ignore
    }
    zxingControlsRef.current = null
    try {
      zxingReaderRef.current?.reset?.()
    } catch {
      // ignore
    }
    zxingReaderRef.current = null
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
    }
    streamRef.current = null
    if (mountedRef.current) {
      setRunning(false)
      setStarting(false)
      setActiveFacingMode(null)
    }
  }, [])

  const start = React.useCallback(async (origin: 'auto' | 'gesture', preferredFacing?: 'user' | 'environment') => {
    stop()
    setError(null)
    setNeedsGesture(false)
    setStarting(true)
    setSupported(true)

    if (!navigator?.mediaDevices?.getUserMedia) {
      setSupported(false)
      setMode('NONE')
      if (mountedRef.current) setStarting(false)
      return
    }

    const token = runTokenRef.current
    const targetFacingMode = preferredFacing || facingMode
    const facingAttempts: Array<'user' | 'environment'> =
      targetFacingMode === 'user' ? ['user', 'environment'] : ['environment', 'user']

    const getStreamWithFallback = async () => {
      let lastError: any = null
      for (const currentFacingMode of facingAttempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: currentFacingMode } as any },
            audio: false,
          })
          return { stream, currentFacingMode }
        } catch (e: any) {
          lastError = e
          const name = String(e?.name || '')
          if (name === 'NotAllowedError' || name === 'SecurityError') break
        }
      }
      throw lastError || new Error('Não foi possível abrir a câmera.')
    }

    const tickBarcodeDetector = async (detector: any, tickToken: number) => {
      if (tickToken !== runTokenRef.current) return
      const video = videoRef.current
      if (!video) return
      try {
        const results = await detector.detect(video)
        const raw = results?.[0]?.rawValue ? String(results[0].rawValue) : ''
        if (raw) {
          stop()
          onDetected(raw)
          return
        }
      } catch {
        // ignore detection errors and keep trying
      }
      rafRef.current = requestAnimationFrame(() => {
        void tickBarcodeDetector(detector, tickToken)
      })
    }

    const Detector = (globalThis as any).BarcodeDetector
    try {
      if (Detector) {
        setMode('BARCODE_DETECTOR')
        const detector = new Detector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
        })
        const { stream, currentFacingMode } = await getStreamWithFallback()
        if (token !== runTokenRef.current) {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) throw new Error('Pré-visualização indisponível.')
        video.srcObject = stream
        await video.play()
        if (token !== runTokenRef.current) return
        setRunning(true)
        setActiveFacingMode(currentFacingMode)
        rafRef.current = requestAnimationFrame(() => {
          void tickBarcodeDetector(detector, token)
        })
        return
      }

      setMode('ZXING')
      const mod: any = await import('@zxing/browser')
      const Reader = mod?.BrowserMultiFormatReader
      if (!Reader) throw new Error('Scanner indisponível.')
      const reader = new Reader()
      zxingReaderRef.current = reader

      const video = videoRef.current
      if (!video) throw new Error('Pré-visualização indisponível.')

      let controls: any = null
      let usedFacingMode: 'user' | 'environment' | null = null
      let lastDecodeError: any = null
      for (const currentFacingMode of facingAttempts) {
        try {
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: currentFacingMode } } } as any,
            video,
            (result: any) => {
              if (token !== runTokenRef.current) return
              const raw = result?.getText ? String(result.getText() || '') : ''
              if (!raw) return
              stop()
              onDetected(raw)
            },
          )
          usedFacingMode = currentFacingMode
          break
        } catch (e: any) {
          lastDecodeError = e
          const name = String(e?.name || '')
          if (name === 'NotAllowedError' || name === 'SecurityError') break
        }
      }
      if (!controls) {
        throw lastDecodeError || new Error('Não foi possível iniciar o scanner de câmera.')
      }
      if (!usedFacingMode) {
        usedFacingMode = targetFacingMode
      }
      if (token !== runTokenRef.current) {
        try {
          controls?.stop?.()
        } catch {
          // ignore
        }
        return
      }
      zxingControlsRef.current = controls
      setRunning(true)
      setActiveFacingMode(usedFacingMode)
    } catch (e: any) {
      const name = String(e?.name || '')
      const message = String(e?.message || '')

      if (origin === 'auto' && (name === 'NotAllowedError' || name === 'SecurityError')) {
        setNeedsGesture(true)
      }

      if (name === 'NotFoundError') {
        setSupported(false)
        setMode('NONE')
        setError('Nenhuma câmera foi encontrada neste dispositivo.')
      } else if (!location?.protocol?.startsWith('https') && location?.hostname !== 'localhost') {
        setSupported(false)
        setMode('NONE')
        setError('O scanner precisa de HTTPS para acessar a câmera.')
      } else {
        setError(message || 'Não foi possível iniciar o scanner. Verifique a permissão de câmera no navegador.')
      }
    } finally {
      if (mountedRef.current && token === runTokenRef.current) setStarting(false)
    }
  }, [facingMode, onDetected, stop])

  React.useEffect(() => {
    void start('auto')
    return () => {
      mountedRef.current = false
      stop()
    }
  }, [start, stop])

  if (!supported) {
    return (
      <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-blue-50">Scanner indisponível</div>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
        <div className="text-sm text-blue-100/70">
          Este navegador não suporta leitura automática de códigos. Digite o código manualmente ou use Chrome/Edge.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-blue-100/80">
          {mode === 'ZXING' ? 'Scanner (compatível)' : 'Scanner (rápido)'} • {activeFacingMode === 'user' ? 'câmera frontal' : 'câmera traseira'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              const next = facingMode === 'user' ? 'environment' : 'user'
              setFacingMode(next)
              void start('gesture', next)
            }}
            disabled={starting}
          >
            Inverter câmera
          </Button>
          {!running ? (
            <Button
              variant="outline"
              onClick={() => void start('gesture')}
              disabled={starting}
              title={needsGesture ? 'Clique para solicitar permissão de câmera' : 'Tentar novamente'}
            >
              {starting ? 'Iniciando…' : needsGesture ? 'Ativar câmera' : 'Tentar novamente'}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => { stop(); onClose() }}>Fechar</Button>
        </div>
      </div>
      {error ? <div className="text-sm text-red-200">{error}</div> : null}
      <div className="relative w-full max-w-xl">
        <video
          ref={videoRef}
          className="w-full rounded-lg border border-white/10 bg-black"
          style={{ transform: activeFacingMode === 'user' ? 'scaleX(-1)' : 'none' }}
          playsInline
          muted
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[28%] w-[78%] rounded-xl border-2 border-emerald-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.24)]">
            <div className="absolute -left-2 -top-2 h-6 w-6 rounded-tl-md border-l-2 border-t-2 border-white/90" />
            <div className="absolute -right-2 -top-2 h-6 w-6 rounded-tr-md border-r-2 border-t-2 border-white/90" />
            <div className="absolute -bottom-2 -left-2 h-6 w-6 rounded-bl-md border-b-2 border-l-2 border-white/90" />
            <div className="absolute -bottom-2 -right-2 h-6 w-6 rounded-br-md border-b-2 border-r-2 border-white/90" />
          </div>
        </div>
      </div>
      <div className="text-xs text-blue-200/60">
        Posicione o código dentro da moldura verde. Se não detectar, aumente a luz e aproxime o produto.
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { ScrollArea } from '@/scroll-area'
import { 
  MagnifyingGlass, 
  WifiHigh, 
  DeviceMobile,
  CheckCircle,
  XCircle,
  Eye
} from '@phosphor-icons/react'
import { toast } from 'sonner'

interface DiscoveredCamera {
  id: string
  name: string
  ip: string
  model: string
  token?: string
  status: 'online' | 'offline' | 'unknown'
  lastSeen: string
}

interface CameraDiscoveryProps {
  onCameraSelect?: (camera: DiscoveredCamera) => void
  onLog?: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

export function CameraDiscovery({ onCameraSelect, onLog }: CameraDiscoveryProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [cameras, setCameras] = useState<DiscoveredCamera[]>([])
  const [scanProgress, setScanProgress] = useState(0)

  const simulatedCameras: DiscoveredCamera[] = [
    {
      id: '1',
      name: 'Smart IP Camera 360',
      ip: '192.168.1.101',
      model: 'mjsxj05cm',
      token: '48a5b5073a2e4d2c8c2e6f1d4e5a3b7c',
      status: 'online',
      lastSeen: 'Just now'
    },
    {
      id: '2',
      name: 'Indoor Security Camera',
      ip: '192.168.1.102',
      model: 'cmsxj01c',
      status: 'online',
      lastSeen: '2 minutes ago'
    },
    {
      id: '3',
      name: 'Outdoor Security Camera',
      ip: '192.168.1.103',
      model: 'dafang',
      status: 'offline',
      lastSeen: '1 hour ago'
    }
  ]

  const startDiscovery = async () => {
    setIsScanning(true)
    setScanProgress(0)
    setCameras([])
    
    onLog?.('INFO', 'Starting network discovery for compatible cameras...')
    toast.info('Scanning network for cameras...')

    // Simulate network scanning process
    const scanSteps = [
      { progress: 20, message: 'Scanning local network range 192.168.1.0/24...' },
      { progress: 40, message: 'Checking for mDNS services...' },
      { progress: 60, message: 'Probing device signatures...' },
      { progress: 80, message: 'Attempting token extraction...' },
      { progress: 100, message: 'Discovery complete' }
    ]

    for (const step of scanSteps) {
      await new Promise(resolve => setTimeout(resolve, 800))
      setScanProgress(step.progress)
      onLog?.('INFO', step.message)
    }

    // Simulate found cameras
    await new Promise(resolve => setTimeout(resolve, 500))
    
    const foundCameras = simulatedCameras.slice(0, Math.floor(Math.random() * 3) + 1)
    setCameras(foundCameras)
    
    onLog?.('INFO', `Discovery found ${foundCameras.length} camera(s)`)
    toast.success(`Found ${foundCameras.length} camera(s)`)
    
    setIsScanning(false)
    setScanProgress(0)
  }

  const getStatusColor = (status: DiscoveredCamera['status']) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'offline': return 'bg-red-500'
      case 'unknown': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusIcon = (status: DiscoveredCamera['status']) => {
    switch (status) {
      case 'online': return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'offline': return <XCircle className="w-4 h-4 text-red-600" />
      case 'unknown': return <Eye className="w-4 h-4 text-yellow-600" />
      default: return null
    }
  }

  const selectCamera = (camera: DiscoveredCamera) => {
    onCameraSelect?.(camera)
    onLog?.('INFO', `Selected camera: ${camera.name} (${camera.ip})`)
    toast.success(`Camera selected: ${camera.name}`)
  }

  const refreshToken = async (cameraId: string) => {
    onLog?.('INFO', `Attempting to refresh token for camera ${cameraId}`)
    toast.info('Refreshing camera token...')
    
    // Simulate token refresh
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    setCameras(prev => prev.map(cam => 
      cam.id === cameraId 
        ? { ...cam, token: Math.random().toString(36).substring(2, 34) }
        : cam
    ))
    
    onLog?.('INFO', 'Token refreshed successfully')
    toast.success('Token refreshed')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiHigh className="w-5 h-5" />
          Camera Discovery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Scan your network for compatible cameras
          </p>
          <Button 
            onClick={startDiscovery} 
            disabled={isScanning}
            size="sm"
          >
            {isScanning ? (
              <>
                <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Scanning...
              </>
            ) : (
              <>
                <MagnifyingGlass className="w-4 h-4 mr-2" />
                Start Discovery
              </>
            )}
          </Button>
        </div>

        {isScanning && (
          <div className="space-y-2">
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${scanProgress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Scanning network... {scanProgress}%
            </p>
          </div>
        )}

        {cameras.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Discovered Cameras ({cameras.length})</h4>
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {cameras.map((camera) => (
                  <div 
                    key={camera.id} 
                    className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(camera.status)}`} />
                      <DeviceMobile className="w-5 h-5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{camera.name}</p>
                          {getStatusIcon(camera.status)}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{camera.ip}</span>
                          <span>{camera.model}</span>
                          <span>{camera.lastSeen}</span>
                        </div>
                        {camera.token && (
                          <Badge variant="outline" className="text-xs mt-1">
                            Token Available
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!camera.token && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => refreshToken(camera.id)}
                        >
                          Get Token
                        </Button>
                      )}
                      <Button 
                        variant="default" 
                        size="sm"
                        onClick={() => selectCamera(camera)}
                        disabled={camera.status === 'offline'}
                      >
                        Use Camera
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {!isScanning && cameras.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <WifiHigh className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No cameras discovered</p>
            <p className="text-sm">Click "Start Discovery" to scan for cameras</p>
          </div>
        )}

        <div className="bg-muted/50 p-3 rounded-lg text-xs text-muted-foreground">
          <p className="font-medium mb-1">Discovery Notes:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Cameras must be on the same network</li>
            <li>Some cameras may require manual token extraction</li>
            <li>Ensure cameras are powered on and connected to WiFi</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

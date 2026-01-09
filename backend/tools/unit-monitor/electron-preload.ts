import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Desktop capture for screen recording
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  
  // File system operations
  selectSaveLocation: () => ipcRenderer.invoke('select-save-location'),
  saveRecording: (buffer: ArrayBuffer, filename: string, savePath: string) =>
    ipcRenderer.invoke('save-recording', buffer, filename, savePath),
  
  // Settings persistence (replaces spark.kv)
  getStoreValue: (key: string) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key: string, value: any) => ipcRenderer.invoke('set-store-value', key, value),
  deleteStoreValue: (key: string) => ipcRenderer.invoke('delete-store-value', key),
  getAllStoreKeys: () => ipcRenderer.invoke('get-all-store-keys'),
  
  // Event listeners
  onRecordingFolderSelected: (callback: (path: string) => void) => {
    ipcRenderer.on('recording-folder-selected', (event, path) => callback(path))
  },
  
  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

// Google Home automation helpers
contextBridge.exposeInMainWorld('googleHomeAPI', {
  // DOM manipulation helpers for Google Home automation
  waitForElement: (selector: string, timeout = 10000): Promise<Element | null> => {
    return new Promise((resolve) => {
      const element = document.querySelector(selector)
      if (element) {
        resolve(element)
        return
      }

      const observer = new MutationObserver((mutations) => {
        const element = document.querySelector(selector)
        if (element) {
          observer.disconnect()
          resolve(element)
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true
      })

      setTimeout(() => {
        observer.disconnect()
        resolve(null)
      }, timeout)
    })
  },

  // Click automation helper
  clickElement: (selector: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const element = document.querySelector(selector) as HTMLElement
      if (element) {
        element.click()
        resolve(true)
      } else {
        resolve(false)
      }
    })
  },

  // Check if user is logged into Google Home
  isLoggedIn: (): boolean => {
    // Look for common Google Home UI elements that indicate successful login
    const indicators = [
      '[data-testid="home-card"]',
      '.home-card',
      '[aria-label="Home control"]',
      '.device-card'
    ]
    
    return indicators.some(selector => document.querySelector(selector) !== null)
  },

  // Find camera elements in the page
  findCameras: (): Array<{id: string, name: string, element: Element}> => {
    const cameras: Array<{id: string, name: string, element: Element}> = []
    
    // Common selectors for camera devices in Google Home
    const cameraSelectors = [
      '[data-device-type="camera"]',
      '.camera-device',
      '[aria-label*="camera" i]',
      '[title*="camera" i]'
    ]

    cameraSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector)
      elements.forEach((element, index) => {
        const name = element.getAttribute('aria-label') || 
                    element.getAttribute('title') || 
                    element.textContent?.trim() || 
                    `Camera ${index + 1}`
        
        cameras.push({
          id: `camera-${Date.now()}-${index}`,
          name,
          element
        })
      })
    })

    return cameras
  },

  // Check if video player is visible
  isVideoPlayerVisible: (): boolean => {
    const videoSelectors = [
      'video',
      '[data-testid="video-player"]',
      '.video-player',
      '[role="img"][src*="video"]'
    ]
    
    return videoSelectors.some(selector => {
      const element = document.querySelector(selector)
      return element && (element as HTMLElement).offsetWidth > 0 && (element as HTMLElement).offsetHeight > 0
    })
  },

  // Get video player bounds for recording
  getVideoPlayerBounds: (): DOMRect | null => {
    const videoSelectors = [
      'video',
      '[data-testid="video-player"]',
      '.video-player'
    ]
    
    for (const selector of videoSelectors) {
      const element = document.querySelector(selector)
      if (element && (element as HTMLElement).offsetWidth > 0) {
        return element.getBoundingClientRect()
      }
    }
    
    return null
  }
})

// Declare global types for TypeScript
declare global {
  interface Window {
    electronAPI: {
      getDesktopSources: () => Promise<Array<{id: string, name: string, thumbnail: string}>>
      selectSaveLocation: () => Promise<string | null>
      saveRecording: (buffer: ArrayBuffer, filename: string, savePath: string) => Promise<{success: boolean, path?: string, error?: string}>
      getStoreValue: (key: string) => Promise<any>
      setStoreValue: (key: string, value: any) => Promise<boolean>
      deleteStoreValue: (key: string) => Promise<boolean>
      getAllStoreKeys: () => Promise<string[]>
      onRecordingFolderSelected: (callback: (path: string) => void) => void
      removeAllListeners: (channel: string) => void
    }
    googleHomeAPI: {
      waitForElement: (selector: string, timeout?: number) => Promise<Element | null>
      clickElement: (selector: string) => Promise<boolean>
      isLoggedIn: () => boolean
      findCameras: () => Array<{id: string, name: string, element: Element}>
      isVideoPlayerVisible: () => boolean
      getVideoPlayerBounds: () => DOMRect | null
    }
  }
}
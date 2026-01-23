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
  }
}

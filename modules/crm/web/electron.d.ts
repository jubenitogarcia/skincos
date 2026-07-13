declare global {
  interface Window {
    electronAPI?: {
      getDesktopSources?: () => Promise<Array<{ id: string; name: string; thumbnail: unknown }>>
      selectSaveLocation?: () => Promise<string | null>
      saveRecording?: (
        buffer: ArrayBuffer,
        filename: string,
        savePath?: string
      ) => Promise<{ success: boolean; path?: string; error?: string }>
      getStoreValue?: (key: string) => Promise<unknown>
      setStoreValue?: (key: string, value: unknown) => Promise<boolean | void>
      deleteStoreValue?: (key: string) => Promise<boolean | void>
      getAllStoreKeys?: () => Promise<string[]>
      onRecordingFolderSelected?: (callback: (path: string) => void) => void
      removeAllListeners?: (channel: string) => void
    }
  }
}

export {}

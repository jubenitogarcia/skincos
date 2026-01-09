import { app, BrowserWindow, ipcMain, dialog, desktopCapturer, Menu, screen } from 'electron'
import type { OpenDialogReturnValue } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFile, mkdir } from 'fs/promises'
import Store from 'electron-store'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize electron store for settings persistence
const store = new Store()

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null
let isRecording = false
let mediaRecorder: any = null

const isDev = process.env.NODE_ENV === 'development'

function createWindow(): void {
  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: Math.min(1400, width - 100),
    height: Math.min(900, height - 100),
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
      webSecurity: !isDev, // Disable web security in dev for local development
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC Handlers
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 150, height: 150 }
    })
    
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }))
  } catch (error) {
    console.error('Error getting desktop sources:', error)
    throw error
  }
})

ipcMain.handle('select-save-location', async () => {
  if (!mainWindow) return null
  
  const result: OpenDialogReturnValue = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Save Location for Recordings'
  })
  
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('save-recording', async (event, buffer: ArrayBuffer, filename: string, savePath: string) => {
  try {
    // Ensure directory exists
    await mkdir(savePath, { recursive: true })
    
    const fullPath = join(savePath, filename)
    await writeFile(fullPath, Buffer.from(buffer))
    
    return { success: true, path: fullPath }
  } catch (error: unknown) {
    console.error('Error saving recording:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('get-store-value', (event, key: string) => {
  return store.get(key)
})

ipcMain.handle('set-store-value', (event, key: string, value: any) => {
  store.set(key, value)
  return true
})

ipcMain.handle('delete-store-value', (event, key: string) => {
  store.delete(key)
  return true
})

ipcMain.handle('get-all-store-keys', () => {
  return Object.keys(store.store)
})

// App event handlers
app.whenReady().then(() => {
  createWindow()

  // Create application menu
  const template: any[] = [
    ...(process.platform === 'darwin' ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Recording Folder',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (mainWindow) {
              const result: OpenDialogReturnValue = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: 'Select Recording Folder'
              })
              if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                mainWindow.webContents.send('recording-folder-selected', result.filePaths[0])
              }
            }
          }
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // Allow opening external links in default browser
    if (url.startsWith('http')) {
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })
})
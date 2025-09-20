// Mock implementations for GitHub Spark Vite plugins

export function createIconImportProxy() {
  return {
    name: 'mock-icon-import-proxy',
    configureServer() {
      // Mock plugin - no-op
    },
    transform(code: string, id: string) {
      // Pass through all code unchanged
      return null
    }
  }
}

export default function sparkPlugin() {
  return {
    name: 'mock-spark-plugin',
    configureServer() {
      // Mock plugin - no-op
    },
    transform(code: string, id: string) {
      // Pass through all code unchanged
      return null
    }
  }
}
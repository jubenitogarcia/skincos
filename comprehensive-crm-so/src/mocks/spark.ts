// Mock implementation of @github/spark/spark
// This provides basic Spark functionality without the actual GitHub Spark package

// Initialize mock Spark environment
console.log('GitHub Spark Mock: Initialized')

  // Mock Spark component registration
  ; (window as any).sparkComponents = (window as any).sparkComponents || {}

  // Mock Spark event system
  ; (window as any).sparkEvents = {
    emit: (event: string, data?: any) => {
      console.log('Spark Event:', event, data)
    },
    on: (event: string, callback: Function) => {
      // Mock event listener
    },
    off: (event: string, callback: Function) => {
      // Mock event removal
    }
  }

// Export default to satisfy import statements
export default {
  version: '1.0.0-mock',
  components: (window as any).sparkComponents,
  events: (window as any).sparkEvents
}

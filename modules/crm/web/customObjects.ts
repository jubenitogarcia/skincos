// Custom Objects System inspired by Twenty CRM
// Allows creating and managing custom data types beyond standard CRM entities

export interface CustomField {
  id: string
  name: string
  label: string
  type: 'text' | 'number' | 'email' | 'phone' | 'date' | 'boolean' | 'select' | 'multiselect' | 'currency' | 'url' | 'textarea'
  required: boolean
  options?: string[] // For select/multiselect fields
  defaultValue?: any
  validation?: {
    pattern?: string
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
  }
  position: number
  isSystem: boolean // System fields cannot be deleted
  createdAt: string
  updatedAt: string
}

export interface CustomObject {
  id: string
  name: string // Internal name (e.g., 'property', 'event', 'project')
  label: string // Display name (e.g., 'Properties', 'Events', 'Projects')
  labelSingular: string // Singular form (e.g., 'Property', 'Event', 'Project')
  description: string
  icon: string // Phosphor icon name
  color: string
  fields: CustomField[]
  isSystem: boolean // System objects like Customer, Opportunity cannot be deleted
  permissions: {
    create: boolean
    read: boolean
    update: boolean
    delete: boolean
  }
  views: ObjectView[]
  createdAt: string
  updatedAt: string
}

export interface ObjectView {
  id: string
  name: string
  type: 'table' | 'kanban' | 'calendar' | 'list'
  objectId: string
  filters: ViewFilter[]
  sorting: ViewSort[]
  groupBy?: string // Field to group by (for kanban)
  visibleFields: string[] // Field IDs to show
  isDefault: boolean
  isPublic: boolean
  createdBy: string
  createdAt: string
}

export interface ViewFilter {
  fieldId: string
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty' | 'in' | 'not_in'
  value: any
  logicalOperator: 'AND' | 'OR'
}

export interface ViewSort {
  fieldId: string
  direction: 'asc' | 'desc'
  position: number
}

export interface CustomRecord {
  id: string
  objectId: string
  data: Record<string, any> // Dynamic data based on custom fields
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}

// Predefined system objects that come with the CRM
export const SYSTEM_OBJECTS: Partial<CustomObject>[] = [
  {
    id: 'customer',
    name: 'customer',
    label: 'Customers',
    labelSingular: 'Customer',
    description: 'Manage your customer relationships',
    icon: 'Users',
    color: 'blue',
    isSystem: true
  },
  {
    id: 'opportunity',
    name: 'opportunity', 
    label: 'Opportunities',
    labelSingular: 'Opportunity',
    description: 'Track sales opportunities and deals',
    icon: 'Target',
    color: 'green',
    isSystem: true
  },
  {
    id: 'activity',
    name: 'activity',
    label: 'Activities',
    labelSingular: 'Activity', 
    description: 'Log interactions and communications',
    icon: 'CalendarCheck',
    color: 'purple',
    isSystem: true
  },
  {
    id: 'campaign',
    name: 'campaign',
    label: 'Campaigns',
    labelSingular: 'Campaign',
    description: 'Marketing campaigns and automation',
    icon: 'EnvelopeSimple',
    color: 'orange',
    isSystem: true
  }
]

// Common custom object templates for quick setup
export const OBJECT_TEMPLATES = [
  {
    name: 'property',
    label: 'Properties',
    labelSingular: 'Property',
    description: 'Real estate properties and listings',
    icon: 'House',
    color: 'emerald',
    fields: [
      { name: 'address', label: 'Address', type: 'textarea', required: true },
      { name: 'price', label: 'Price', type: 'currency', required: true },
      { name: 'bedrooms', label: 'Bedrooms', type: 'number', required: false },
      { name: 'bathrooms', label: 'Bathrooms', type: 'number', required: false },
      { name: 'sqft', label: 'Square Feet', type: 'number', required: false },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['Available', 'Under Contract', 'Sold', 'Off Market'] }
    ]
  },
  {
    name: 'event',
    label: 'Events',
    labelSingular: 'Event',
    description: 'Conferences, meetings, and events',
    icon: 'CalendarDots',
    color: 'violet',
    fields: [
      { name: 'title', label: 'Event Title', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: false },
      { name: 'startDate', label: 'Start Date', type: 'date', required: true },
      { name: 'endDate', label: 'End Date', type: 'date', required: false },
      { name: 'location', label: 'Location', type: 'text', required: false },
      { name: 'attendees', label: 'Expected Attendees', type: 'number', required: false },
      { name: 'type', label: 'Event Type', type: 'select', required: true, options: ['Conference', 'Workshop', 'Webinar', 'Meeting', 'Trade Show'] }
    ]
  },
  {
    name: 'project',
    label: 'Projects',
    labelSingular: 'Project',
    description: 'Track client projects and deliverables',
    icon: 'FolderOpen',
    color: 'cyan',
    fields: [
      { name: 'name', label: 'Project Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: false },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['Planning', 'In Progress', 'Review', 'Completed', 'On Hold'] },
      { name: 'budget', label: 'Budget', type: 'currency', required: false },
      { name: 'startDate', label: 'Start Date', type: 'date', required: true },
      { name: 'endDate', label: 'End Date', type: 'date', required: false },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'] }
    ]
  },
  {
    name: 'product',
    label: 'Products',
    labelSingular: 'Product',
    description: 'Product catalog and inventory',
    icon: 'Package',
    color: 'amber',
    fields: [
      { name: 'name', label: 'Product Name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: false },
      { name: 'sku', label: 'SKU', type: 'text', required: true },
      { name: 'price', label: 'Price', type: 'currency', required: true },
      { name: 'category', label: 'Category', type: 'select', required: true, options: ['Software', 'Hardware', 'Service', 'Digital', 'Physical'] },
      { name: 'inStock', label: 'In Stock', type: 'boolean', required: true },
      { name: 'website', label: 'Product URL', type: 'url', required: false }
    ]
  }
]
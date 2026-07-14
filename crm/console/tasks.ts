// Enhanced Task Management System inspired by Twenty CRM
// Includes rich text editing, dependencies, and advanced task features

export interface Task {
  id: string
  title: string
  description: string // Rich text content
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignedTo?: string
  assignedBy: string
  dueDate?: string
  startDate?: string
  completedAt?: string
  estimatedHours?: number
  actualHours?: number

  // Rich relationships
  relatedTo?: {
    type: 'customer' | 'opportunity' | 'project' | 'campaign' | string // Can relate to custom objects
    id: string
    name: string
  }

  // Task dependencies
  dependencies: string[] // Task IDs that must be completed first
  blockedBy: string[] // Task IDs blocking this task

  // Rich content support
  attachments: TaskAttachment[]
  comments: TaskComment[]

  // Task hierarchy
  parentTaskId?: string
  subtasks: string[] // Child task IDs

  // Tracking and automation
  tags: string[]
  labels: string[]
  progress: number // 0-100
  repeatConfig?: TaskRepeatConfig

  // AI features
  aiGenerated: boolean
  aiSuggestions: string[]
  autoAssignReason?: string

  // Metadata
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}

export interface TaskAttachment {
  id: string
  taskId: string
  fileName: string
  fileType: string
  fileSize: number
  url: string
  uploadedBy: string
  uploadedAt: string
}

export interface TaskComment {
  id: string
  taskId: string
  content: string // Rich text
  author: string
  authorName: string
  createdAt: string
  updatedAt: string
  mentions: string[] // User IDs mentioned in comment
  isInternal: boolean // Internal team comment vs customer-visible
}

export interface TaskRepeatConfig {
  enabled: boolean
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
  interval: number // Every X days/weeks/months
  daysOfWeek?: number[] // For weekly: 0=Sunday, 1=Monday, etc.
  dayOfMonth?: number // For monthly
  endDate?: string
  endAfterOccurrences?: number
}

export interface TaskTemplate {
  id: string
  name: string
  description: string
  tasks: Partial<Task>[]
  category: string
  tags: string[]
  estimatedDuration: number // Total hours for all tasks
  createdBy: string
  createdAt: string
  isPublic: boolean
}

export interface TaskBoard {
  id: string
  name: string
  description: string
  columns: TaskColumn[]
  filters: TaskFilter[]
  groupBy?: 'assignee' | 'priority' | 'dueDate' | 'project'
  viewType: 'kanban' | 'list' | 'calendar' | 'gantt'
  isDefault: boolean
  permissions: {
    view: string[] // User IDs
    edit: string[] // User IDs
    admin: string[] // User IDs
  }
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TaskColumn {
  id: string
  name: string
  status: Task['status']
  color: string
  position: number
  isCollapsed: boolean
  taskLimit?: number // WIP limit
}

export interface TaskFilter {
  field: keyof Task
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in' | 'is_empty' | 'is_not_empty'
  value: any
  logicalOperator: 'AND' | 'OR'
}

// Rich text content blocks for task descriptions
export interface RichTextBlock {
  id: string
  type: 'text' | 'heading' | 'list' | 'code' | 'quote' | 'image' | 'file' | 'checklist'
  content: string | RichTextContent
  position: number
}

export interface RichTextContent {
  text?: string
  level?: number // For headings (1-6)
  items?: string[] // For lists
  language?: string // For code blocks
  url?: string // For images/files
  fileName?: string // For files
  checked?: boolean // For checklist items
}

// Predefined task templates for common workflows
export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'customer-onboarding',
    name: 'Customer Onboarding',
    description: 'Complete customer onboarding process',
    category: 'Sales',
    tags: ['onboarding', 'customer'],
    estimatedDuration: 16,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
    isPublic: true,
    tasks: [
      {
        title: 'Send welcome email',
        description: 'Send personalized welcome email with next steps',
        priority: 'high',
        estimatedHours: 0.5
      },
      {
        title: 'Schedule kickoff call',
        description: 'Schedule and prepare for customer kickoff meeting',
        priority: 'high',
        estimatedHours: 1
      },
      {
        title: 'Prepare onboarding materials',
        description: 'Gather and customize onboarding documentation',
        priority: 'medium',
        estimatedHours: 2
      },
      {
        title: 'Conduct kickoff meeting',
        description: 'Lead customer through kickoff process and requirements gathering',
        priority: 'high',
        estimatedHours: 2
      },
      {
        title: 'Set up customer account',
        description: 'Configure customer account and initial settings',
        priority: 'high',
        estimatedHours: 3
      },
      {
        title: 'Deliver training session',
        description: 'Conduct product training for customer team',
        priority: 'medium',
        estimatedHours: 4
      },
      {
        title: 'Follow-up and feedback',
        description: 'Check in with customer and gather feedback',
        priority: 'medium',
        estimatedHours: 1
      }
    ]
  },
  {
    id: 'lead-qualification',
    name: 'Lead Qualification Process',
    description: 'Comprehensive lead qualification workflow',
    category: 'Sales',
    tags: ['lead', 'qualification', 'sales'],
    estimatedDuration: 6,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
    isPublic: true,
    tasks: [
      {
        title: 'Initial contact attempt',
        description: 'Make first contact via preferred channel',
        priority: 'high',
        estimatedHours: 0.5
      },
      {
        title: 'Research prospect company',
        description: 'Gather company information and context',
        priority: 'medium',
        estimatedHours: 1
      },
      {
        title: 'Qualify budget and authority',
        description: 'Determine budget range and decision-making process',
        priority: 'high',
        estimatedHours: 1
      },
      {
        title: 'Identify pain points',
        description: 'Understand challenges and needs',
        priority: 'high',
        estimatedHours: 1.5
      },
      {
        title: 'Present solution overview',
        description: 'Share relevant solution overview and value proposition',
        priority: 'medium',
        estimatedHours: 1
      },
      {
        title: 'Schedule demo or next steps',
        description: 'Book product demo or next meeting',
        priority: 'high',
        estimatedHours: 0.5
      },
      {
        title: 'Update opportunity record',
        description: 'Document qualification results and next actions',
        priority: 'medium',
        estimatedHours: 0.5
      }
    ]
  }
]

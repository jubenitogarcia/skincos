export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  company: string
  avatar?: string
  status: 'lead' | 'prospect' | 'customer' | 'inactive'
  score: number
  lastContact: string
  totalValue: number
  createdAt: string
  source: string
  tags: string[]
  notes: string
}

export interface Opportunity {
  id: string
  customerId: string
  title: string
  value: number
  stage: 'qualification' | 'proposal' | 'negotiation' | 'closed-won' | 'closed-lost'
  probability: number
  expectedCloseDate: string
  assignedTo: string
  createdAt: string
  lastActivity: string
  description: string
  aiScore: number
  aiInsights: string[]
}

export interface Activity {
  id: string
  customerId: string
  type: 'call' | 'email' | 'meeting' | 'note' | 'whatsapp' | 'sms'
  title: string
  description: string
  date: string
  duration?: number
  outcome?: string
  createdBy: string
  channel: string
}

export interface Campaign {
  id: string
  name: string
  type: 'email' | 'sms' | 'whatsapp' | 'social'
  status: 'draft' | 'active' | 'paused' | 'completed'
  targetSegment: string
  startDate: string
  endDate?: string
  metrics: {
    sent: number
    opened: number
    clicked: number
    converted: number
  }
  aiOptimized: boolean
}

export interface DashboardMetric {
  id: string
  title: string
  value: string
  change: number
  trend: 'up' | 'down' | 'stable'
  icon: string
  color: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  sender: 'user' | 'ai' | 'agent'
  content: string
  timestamp: Date
  type: 'text' | 'file' | 'image'
  metadata?: {
    aiConfidence?: number
    escalated?: boolean
    sentiment?: 'positive' | 'neutral' | 'negative'
    intent?: string
  }
}

export interface ChatConversation {
  id: string
  customerId?: string
  customerName: string
  customerEmail?: string
  status: 'active' | 'resolved' | 'escalated' | 'pending'
  channel: 'chat' | 'whatsapp' | 'email' | 'phone'
  lastMessage: string
  lastActivity: Date
  assignedAgent?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  tags: string[]
  aiHandled: boolean
}

// Twenty CRM inspired additions
export interface ViewConfig {
  id: string
  name: string
  type: 'table' | 'kanban' | 'calendar' | 'list'
  filters: Record<string, any>
  sorting: { field: string, direction: 'asc' | 'desc' }[]
  groupBy?: string
  columns: string[]
  isDefault: boolean
}

export interface FieldDefinition {
  id: string
  name: string
  label: string
  type: 'text' | 'number' | 'email' | 'phone' | 'date' | 'boolean' | 'select' | 'multiselect' | 'currency' | 'url' | 'textarea'
  required: boolean
  options?: string[]
  validation?: Record<string, any>
  position: number
}

export interface DataRecord {
  id: string
  objectType: string
  data: Record<string, any>
  createdAt: string
  updatedAt: string
  createdBy: string
}
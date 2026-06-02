export type SiteTrackingWindowDays = 7 | 30 | 60 | 90

export type SiteTrackingHeaderBadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

export type SiteTrackingHeaderSiteOption = {
  id: string
  name: string
  host: string
  statusLabel?: string
  statusTone?: SiteTrackingHeaderBadgeTone
}

export type SiteTrackingHeaderState = {
  refreshing: boolean
  sites: SiteTrackingHeaderSiteOption[]
  selectedSiteId: string
  windowDays: SiteTrackingWindowDays
  selectedSiteName?: string
  updatedAt?: string
}

export type SiteTrackingHeaderAction =
  | { type: 'set-site'; value: string }
  | { type: 'rename-site'; value?: string }
  | { type: 'set-window'; value: SiteTrackingWindowDays }
  | { type: 'connect' }
  | { type: 'refresh' }

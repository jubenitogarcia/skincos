export type SocialPlatform = 'instagram' | 'facebook' | 'threads'

export type SocialAccountConfig = {
  platform: SocialPlatform
  unitKey: string
  accountId: string
  accessToken: string
  apiBase?: string
  apiVersion?: string
  updatedAt: string
}

export type SocialQueueGroup = {
  dateKey: string
  groupKey: string
  scheduledAt: string
  unitKeys: string[]
  platforms: SocialPlatform[]
  captions?: Partial<Record<SocialPlatform, string>>
  createdAt: string
  updatedAt?: string
}

export type SocialQueueAsset = {
  assetId: string
  originalName: string
  contentType?: string
  size?: number
  createdAt: string
  unitKey: string
  platforms: SocialPlatform[]
  dateKey: string
  groupKey: string
  scheduledAt: string
  fileKey: string
}


import type { SocialPlatform } from './socialTypes'

export const socialAccountKey = (unitKey: string, platform: SocialPlatform) =>
  `internal/social/accounts/${encodeURIComponent(unitKey)}/${platform}.json`

export const socialAssetMetaKey = (assetId: string) => `social/assets/${assetId}/meta.json`

export const socialAssetFileKey = (assetId: string) => `social/assets/${assetId}/file`

export const socialQueueGroupPrefix = (dateKey: string, groupKey: string) => `social/queue/${dateKey}/${groupKey}/`

export const socialQueueGroupKey = (dateKey: string, groupKey: string) => `${socialQueueGroupPrefix(dateKey, groupKey)}group.json`

export const socialQueueAssetPointerKey = (dateKey: string, groupKey: string, assetId: string) =>
  `${socialQueueGroupPrefix(dateKey, groupKey)}assets/${assetId}.json`

export const socialPublishedMarkerKey = (dateKey: string, groupKey: string, unitKey: string, platform: SocialPlatform) =>
  `social/published/${dateKey}/${groupKey}/${encodeURIComponent(unitKey)}/${platform}.json`


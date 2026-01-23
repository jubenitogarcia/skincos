import { getJson, putJson } from './r2'
import { socialAssetMetaKey, socialPublishedMarkerKey, socialQueueGroupKey, socialQueueAssetPointerKey } from './socialKeys'
import type { SocialPlatform, SocialQueueAsset, SocialQueueGroup } from './socialTypes'

export async function readAssetMeta(bucket: R2Bucket, assetId: string): Promise<SocialQueueAsset | null> {
  return getJson<SocialQueueAsset>(bucket, socialAssetMetaKey(assetId))
}

export async function upsertGroup(bucket: R2Bucket, group: SocialQueueGroup) {
  await putJson(bucket, socialQueueGroupKey(group.dateKey, group.groupKey), group)
}

export async function upsertAssetPointer(bucket: R2Bucket, dateKey: string, groupKey: string, assetId: string) {
  await putJson(bucket, socialQueueAssetPointerKey(dateKey, groupKey, assetId), { assetId, at: new Date().toISOString() })
}

export async function isPublished(bucket: R2Bucket, dateKey: string, groupKey: string, unitKey: string, platform: SocialPlatform) {
  const head = await bucket.head(socialPublishedMarkerKey(dateKey, groupKey, unitKey, platform))
  return !!head
}

export async function markPublished(bucket: R2Bucket, args: { dateKey: string; groupKey: string; unitKey: string; platform: SocialPlatform; result: any }) {
  await putJson(bucket, socialPublishedMarkerKey(args.dateKey, args.groupKey, args.unitKey, args.platform), {
    ok: true,
    publishedAt: new Date().toISOString(),
    result: args.result,
  })
}


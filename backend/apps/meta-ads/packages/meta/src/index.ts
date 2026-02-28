import pino from 'pino';
import bizSdk from 'facebook-nodejs-business-sdk';

export type MetaClientConfig = {
  accessToken: string;
  appId?: string;
  appSecret?: string;
  debug?: boolean;
};

const logger = pino({ name: 'meta-client' });
const { FacebookAdsApi, AdAccount, Ad, AdSet, Campaign, User } = bizSdk as any;

export function initMetaClient(config: MetaClientConfig) {
  const api = FacebookAdsApi.init(config.accessToken);
  if (config.debug) {
    api.setDebug(true);
  }
  return api;
}

async function collectAll<T>(cursor: any): Promise<T[]> {
  const results: T[] = [];
  let current = cursor;
  while (current) {
    results.push(...current);
    if (current.hasNext && current.hasNext()) {
      current = await current.next();
    } else {
      break;
    }
  }
  return results;
}

export async function listAdAccounts(accessToken: string) {
  initMetaClient({ accessToken });
  const me = new User('me');
  const cursor = await me.getAdAccounts([
    'id',
    'name',
    'account_status',
    'currency',
    'timezone_name',
    'permissions',
  ]);
  return collectAll(cursor);
}

export async function listCampaigns(accessToken: string, adAccountId: string) {
  initMetaClient({ accessToken });
  const account = new AdAccount(adAccountId);
  const cursor = await account.getCampaigns([
    'id',
    'name',
    'status',
    'objective',
    'daily_budget',
    'lifetime_budget',
  ]);
  return collectAll(cursor);
}

export async function listAdSets(accessToken: string, adAccountId: string) {
  initMetaClient({ accessToken });
  const account = new AdAccount(adAccountId);
  const cursor = await account.getAdSets([
    'id',
    'name',
    'status',
    'daily_budget',
    'lifetime_budget',
    'bid_strategy',
    'start_time',
    'end_time',
  ]);
  return collectAll(cursor);
}

export async function listAds(accessToken: string, adAccountId: string) {
  initMetaClient({ accessToken });
  const account = new AdAccount(adAccountId);
  const cursor = await account.getAds(['id', 'name', 'status']);
  return collectAll(cursor);
}

export async function updateCampaign(accessToken: string, id: string, payload: any) {
  initMetaClient({ accessToken });
  const campaign = new Campaign(id);
  return campaign.update(payload);
}

export async function updateAdSet(accessToken: string, id: string, payload: any) {
  initMetaClient({ accessToken });
  const adset = new AdSet(id);
  return adset.update(payload);
}

export async function updateAd(accessToken: string, id: string, payload: any) {
  initMetaClient({ accessToken });
  const ad = new Ad(id);
  return ad.update(payload);
}

export async function createCampaign(accessToken: string, adAccountId: string, payload: any) {
  initMetaClient({ accessToken });
  const account = new AdAccount(adAccountId);
  return account.createCampaign([], payload);
}

export async function copyCampaign(accessToken: string, id: string, params: any = {}) {
  initMetaClient({ accessToken });
  const campaign = new Campaign(id);
  return campaign.createCopy([], params);
}

export async function copyAdSet(accessToken: string, id: string, params: any = {}) {
  initMetaClient({ accessToken });
  const adset = new AdSet(id);
  return adset.createCopy([], params);
}

export async function copyAd(accessToken: string, id: string, params: any = {}) {
  initMetaClient({ accessToken });
  const ad = new Ad(id);
  return ad.createCopy([], params);
}

export async function getInsights(
  accessToken: string,
  adAccountId: string,
  params: { level: 'campaign' | 'adset' | 'ad'; since: string; until: string },
) {
  initMetaClient({ accessToken });
  const account = new AdAccount(adAccountId);
  const cursor = await account.getInsights(
    [
      'date_start',
      'date_stop',
      'spend',
      'impressions',
      'clicks',
      'actions',
      'purchase_roas',
      'campaign_id',
      'adset_id',
      'ad_id',
    ],
    {
      level: params.level,
      time_range: { since: params.since, until: params.until },
      time_increment: 1,
    },
  );
  return collectAll(cursor);
}

export async function batchUpdate(
  accessToken: string,
  items: Array<{ id: string; payload: Record<string, string | number> }>,
) {
  const api = initMetaClient({ accessToken });
  if (items.length === 0) return [];
  const batch = items.map((item) => ({
    method: 'POST',
    relative_url: item.id,
    body: new URLSearchParams(
      Object.entries(item.payload).reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {}),
    ).toString(),
  }));

  logger.info({ count: items.length }, 'Executing batch update');
  const response = await api.call('POST', '/', {
    batch,
    include_headers: 'false',
  });
  return response;
}

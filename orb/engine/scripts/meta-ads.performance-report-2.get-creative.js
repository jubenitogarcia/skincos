function safeString(value) {
  return value == null ? '' : String(value).trim();
}

const PRIMARY_FIELD_LIST = 'id,name,status,account_id,asset_feed_spec,image_hash,image_url';
const FALLBACK_FIELD_LIST = 'id,name,status,account_id';
const apiVersion = safeString($('Meta API Params').first().json.api_version) || 'v24.0';
const accessToken = safeString($('Meta API Params').first().json.meta_ads_access_token);

if (!accessToken) {
  throw new Error('meta_ads_access_token ausente na configuração operacional.');
}

const results = [];

async function fetchCreativePayload(creativeId, fieldList) {
  const url = `https://graph.facebook.com/${apiVersion}/${creativeId}?fields=${encodeURIComponent(fieldList)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const responseText = await response.text();
  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    payload = { raw: responseText };
  }

  return {
    ok: response.ok && !payload?.error,
    status: response.status,
    payload,
    fieldList,
  };
}

for (let index = 0; index < items.length; index += 1) {
  const row = items[index]?.json || {};
  const creativeId = safeString(row.creative_id);

  if (!creativeId) {
    continue;
  }

  let fetchResult = await fetchCreativePayload(creativeId, PRIMARY_FIELD_LIST);

  if (!fetchResult.ok) {
    const errorMessage = safeString(fetchResult.payload?.error?.message);
    const shouldFallback =
      fetchResult.payload?.error?.code === 100 &&
      /nonexisting field/i.test(errorMessage);

    if (shouldFallback) {
      const fallbackResult = await fetchCreativePayload(creativeId, FALLBACK_FIELD_LIST);
      if (fallbackResult.ok) {
        fallbackResult.payload = {
          ...fallbackResult.payload,
          creative_fetch_degraded: true,
          creative_fetch_warning: errorMessage,
          creative_fetch_fields_used: FALLBACK_FIELD_LIST,
        };
        fetchResult = fallbackResult;
      }
    }
  }

  if (!fetchResult.ok) {
    const errorMessage =
      fetchResult.payload?.error?.message ||
      `Graph API returned status ${fetchResult.status} for creative ${creativeId}.`;
    throw new Error(`Get Creative failed for ${creativeId}: ${errorMessage}`);
  }

  results.push({
    json: fetchResult.payload,
    pairedItem: { item: index },
  });
}

return results;

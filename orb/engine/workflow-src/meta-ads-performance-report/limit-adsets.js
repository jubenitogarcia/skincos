function readPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const limit = readPositiveInt($('Params').first()?.json?.max_adsets_per_campaign);

return $input.all().map((item) => {
  const data = Array.isArray(item.json?.data) ? item.json.data : null;
  if (!limit || !data) return item;

  return {
    json: {
      ...item.json,
      data: data.slice(0, limit),
      collection_limits: {
        ...(item.json?.collection_limits || {}),
        max_adsets_per_campaign: limit,
      },
    },
    pairedItem: item.pairedItem,
  };
});

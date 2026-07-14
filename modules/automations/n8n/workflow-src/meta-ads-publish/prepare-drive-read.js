function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

const expected = $items('Build Drive Finalization') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const source = (expected[sourceIndex] || {}).json || {};
  return {
    json: {
      ...source,
      drive_update_response: item.json || {},
      drive_update_had_error: Boolean(item.json && item.json.error),
    },
    pairedItem: { item: sourceIndex },
  };
});

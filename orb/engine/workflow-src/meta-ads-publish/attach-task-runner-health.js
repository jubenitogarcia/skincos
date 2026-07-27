function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

const prepared = $items('Prepare Publish Run') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const source = prepared[sourceIndex] || prepared[index];
  if (!source || !source.json) {
    throw new Error(`Task Runner health sem item correlacionado de Prepare Publish Run; index=${index}.`);
  }
  return {
    json: {
      ...source.json,
      task_runner_health: {
        ok: true,
        endpoint: 'loopback',
        checked_at: new Date().toISOString(),
      },
    },
    binary: source.binary || {},
    pairedItem: { item: sourceIndex },
  };
});

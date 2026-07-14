function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const response = $input.first()?.json || {};
const body = response.body && typeof response.body === 'object' ? response.body : response;
const inventory = body.inventory && typeof body.inventory === 'object' ? body.inventory : {};
const items = Array.isArray(body.items) ? body.items : [];

if (!items.length) {
  return [{
    json: {
      inventory_available: false,
      inventory_count: 0,
      inventory_meta: deepClone(inventory),
      inventory_error: safeString(body.message || response.message),
    },
  }];
}

return items.map((item, index) => ({
  json: {
    ...deepClone(item),
    inventory_available: true,
    inventory_count: items.length,
    inventory_index: index,
    inventory_meta: deepClone(inventory),
  },
}));

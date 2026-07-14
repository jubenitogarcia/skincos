function str(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cloneRow(group, row, groupIndex, itemCount) {
  const base = {
    ...group,
    ...row,
  };

  delete base.items;
  delete base.waitUntil;
  delete base.hour;
  delete base.minute;
  delete base.targetDate;
  delete base.postPrefix;

  return {
    ...base,
    groupKey: str(row.groupKey || group.groupKey, ""),
    groupOrder: row.groupOrder ?? group.groupOrder ?? groupIndex,
    publishTime: str(row.publishTime || group.publishTime, ""),
    quantity: Number(row.quantity ?? group.quantity ?? itemCount ?? 1),
    facebook: asObject(row.facebook && typeof row.facebook === "object" ? row.facebook : group.facebook),
    instagram: asObject(row.instagram && typeof row.instagram === "object" ? row.instagram : group.instagram),
    threads: asObject(row.threads && typeof row.threads === "object" ? row.threads : group.threads),
  };
}

function getInputRows() {
  try {
    if (typeof $input !== "undefined" && $input && typeof $input.all === "function") {
      return $input.all() || [];
    }
  } catch {}
  return [];
}

const groups = getInputRows()
  .map((item) => item.json || {})
  .filter((item) => item && typeof item === "object");

if (!groups.length) return [];

const output = [];

groups
  .sort((left, right) => {
    const leftOrder = Number(left.groupOrder ?? 0);
    const rightOrder = Number(right.groupOrder ?? 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return str(left.groupKey).localeCompare(str(right.groupKey));
  })
  .forEach((group, groupIndex) => {
    const groupedItems = Array.isArray(group.items) && group.items.length
      ? group.items
      : [group];

    groupedItems.forEach((row) => {
      output.push({
        json: cloneRow(group, asObject(row), groupIndex, groupedItems.length),
      });
    });
  });

try {
  const sd = $getWorkflowStaticData("global");
  const execId = str($execution?.id, "noexec");
  sd.__liviaCompose1 ||= {};
  for (const key of Object.keys(sd.__liviaCompose1)) {
    if (key !== execId) delete sd.__liviaCompose1[key];
  }

  const store = { __items: output };
  for (const item of output) {
    const row = item.json || {};
    const fileBase = str(row.name, "").replace(/\.[^.]+$/, "");
    const keys = [
      row.id,
      row.name,
      row.groupKey,
      row.webContentLink,
      fileBase,
    ].filter(Boolean);

    for (const key of keys) {
      store[String(key)] = row;
    }
  }

  sd.__liviaCompose1[execId] = store;
} catch {}

return output;

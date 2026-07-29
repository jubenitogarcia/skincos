const main = $items('Attach Video Main') || [];
return $input.all().map((item, index) => ({ json: main[index]?.json || {}, binary: { data: main[index]?.binary?.data, analysis: item.binary?.analysis } }));

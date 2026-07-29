const prior = $items('Attach Video Analysis') || [];
return $input.all().map((item, index) => ({ json: prior[index]?.json || {}, binary: { data: prior[index]?.binary?.data, analysis: prior[index]?.binary?.analysis, thumbnail: item.binary?.thumbnail } }));

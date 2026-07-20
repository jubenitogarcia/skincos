const metadata = $items('Attach Video Transcript') || [];
return $input.all().map((item, index) => ({ json: metadata[index]?.json || {}, binary: { data: item.binary?.data } }));

function text(value) { return String(value ?? '').trim(); }
function unitSlug(destinationGroup) {
  const normalized = text(destinationGroup).toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '');
  if (normalized === 'barrashoppingsul') return 'barra-shopping-sul';
  if (normalized === 'novohamburgo') return 'novo-hamburgo';
  throw new Error(`Destino CRM desconhecido: ${text(destinationGroup) || 'vazio'}.`);
}

return $input.all().flatMap((item) => {
  const job = item.json || {};
  const jobKey = text(job.job_key);
  const groupKey = text(job.group_key);
  const destinations = Array.isArray(job.destinations) ? job.destinations : [];
  if (!jobKey || !groupKey || !destinations.length) throw new Error('Prepare CRM Offer Context Requests exige job_key, group_key e destinos.');
  const seen = new Set();
  return destinations.map((destination) => {
    const destinationGroup = text(destination?.destination_group);
    const crmUnit = unitSlug(destinationGroup);
    if (seen.has(crmUnit)) throw new Error(`Destino CRM duplicado em ${jobKey}: ${crmUnit}.`);
    seen.add(crmUnit);
    return {
      json: {
        job_key: jobKey,
        group_key: groupKey,
        crm_unit: crmUnit,
        crm_destination_group: destinationGroup,
        crm_source_job: job,
      },
      binary: item.binary || {},
      pairedItem: item.pairedItem,
    };
  });
});

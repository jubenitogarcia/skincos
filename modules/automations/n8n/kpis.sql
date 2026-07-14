-- KPIs mínimos (wa_n8n)

-- 1) First response time (segundos)
with first_inbound as (
  select conversation_id, min(created_at) as ts
  from wa_n8n.events
  where event_type = 'message_received'
  group by conversation_id
),
first_outbound as (
  select conversation_id, min(created_at) as ts
  from wa_n8n.events
  where event_type = 'outbound_message_queued'
  group by conversation_id
)
select avg(extract(epoch from (o.ts - i.ts))) as first_response_time_sec
from first_inbound i
join first_outbound o on o.conversation_id = i.conversation_id;

-- 2) Qualification rate
with leads as (
  select distinct conversation_id
  from wa_n8n.events
  where event_type = 'message_received'
),
qualified as (
  select distinct conversation_id
  from wa_n8n.events
  where event_type = 'status_changed'
    and payload->>'status' = 'qualificado'
)
select
  count(qualified.conversation_id)::decimal / nullif(count(leads.conversation_id), 0) as qualification_rate
from leads
left join qualified on qualified.conversation_id = leads.conversation_id;

-- 3) Scheduling rate
select
  count(*) filter (where funnel_status = 'agendado')::decimal / nullif(count(*) filter (where funnel_status in ('qualificado','agendamento_sugerido','agendado')), 0) as scheduling_rate
from wa_n8n.conversations;

-- 4) Show rate
select
  count(*) filter (where funnel_status = 'compareceu')::decimal / nullif(count(*) filter (where funnel_status in ('agendado','confirmado','compareceu','no_show')), 0) as show_rate
from wa_n8n.conversations;

-- 5) No-show rate
select
  count(*) filter (where funnel_status = 'no_show')::decimal / nullif(count(*) filter (where funnel_status in ('agendado','confirmado','compareceu','no_show')), 0) as no_show_rate
from wa_n8n.conversations;

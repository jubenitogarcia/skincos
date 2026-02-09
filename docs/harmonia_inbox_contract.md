Harmonia Inbox Contract (Draft)
================================

Scope
-----
This contract defines the minimum data model and behaviors for the Harmonia
inbox inside the CRM. It applies only to the Harmonia module/aba and its
direct interfaces (Harmonia API + WhatsApp/Instagram/HelpDesk/Omnichannel UI
entry points).

Goal
----
Create a single, operable inbox view that aggregates conversations across
channels with consistent states, ownership, and SLA.

Entities (canonical)
--------------------
Conversation
- id (uuid)
- channel (enum): whatsapp | instagram | other
- source_ref (string): provider conversation id (e.g. wa_jid, ig_thread_id)
- unit_slug (string)
- contact_id (uuid)
- status (enum): new | in_progress | waiting_customer | done | closed
- assignee_id (string, optional)
- last_activity_at (timestamp)
- last_message_at (timestamp)
- created_at, updated_at

Contact
- id (uuid)
- display_name (string, optional)
- phone_raw (string, optional)
- external_ids (map): { whatsapp?: string, instagram?: string, ... }
- opted_out_at (timestamp, optional)

Message
- id (uuid)
- conversation_id (uuid)
- direction (enum): inbound | outbound
- text (string, optional)
- created_at (timestamp)
- raw_ref (string, optional; points to provider payload)

SLA
- first_response_due_at (timestamp, optional)
- next_response_due_at (timestamp, optional)

State machine (minimum)
-----------------------
new -> in_progress -> waiting_customer -> in_progress
in_progress -> done
in_progress -> closed (manual close)

Transitions must be auditable and never drop history.

Channel mapping (minimum)
-------------------------
whatsapp
- source_ref: wa_jid or provider_message_id thread id
- contact.external_ids.whatsapp = wa_jid or phone

instagram
- source_ref: ig_thread_id
- contact.external_ids.instagram = ig_user_id

Assumptions (must be verified)
------------------------------
1) WhatsApp provider exposes a stable thread identifier for a conversation.
2) Instagram module exposes a stable thread id and sender id.
3) A single contact can be resolved across channels by phone or explicit mapping.

Verification (minimum)
----------------------
1) For each channel, confirm "source_ref" and "contact.external_ids" fields exist.
2) Create 2 test conversations per channel and verify status transitions.
3) Confirm inbox ordering by last_activity_at and that pagination is stable.

Acceptance criteria (system)
----------------------------
1) Inbox lists conversations from all configured channels in a single feed.
2) Each item shows: channel, contact, status, assignee (if any), last message.
3) Operators can change status and assignee; changes are logged.
4) SLA fields are computed and visible for in_progress items.


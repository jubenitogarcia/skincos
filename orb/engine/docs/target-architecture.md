# Target architecture

```mermaid
flowchart LR
  O["Organizer"] --> A["adapter-organizer-input"]
  A --> C["Campaign Creative Generator (Unified)"]
  M["Manual safe dry-run smoke"] --> C
  C --> G["Grounding"]
  G --> S["Strategy"]
  S --> P["Preproduction"]
  P --> AF["Asset Factory"]
  AF --> SF["Scene Factory"]
  SF --> AU["Audio Factory"]
  AU --> AS["Assembly"]
  AS --> F["Finalization"]
  F --> QA["QA and CONTENT_PACKAGE"]
  QA --> PO["adapter-posting-output"]
```

The stages are inline Code nodes in one n8n workflow; there are no Execute Workflow dependencies. The manual entry creates only a fixed fixture with `dry_run=true`, mock provider policy, zero cost and `publish_requested=false`. Large assets stay in storage and move through the graph as URI, ID, checksum and metadata. The final adapter is a contract boundary only; it has no publication capability.

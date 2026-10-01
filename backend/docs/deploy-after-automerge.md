# Deploy após automerge

Este repositório usa workflows canônicos por domínio. Um PR integrado em
`main` deve ser validado pelo pipeline correspondente à superfície alterada;
não existe um publisher composto para produtos externos.

Se um deploy for necessário após automerge, selecione explicitamente o
workflow do domínio e o SHA exato de `main`. O workflow deve repetir preflight,
custódia, smoke, readback e rollback do mesmo artefato.

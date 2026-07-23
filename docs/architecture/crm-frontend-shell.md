# Shell lógico do CRM

`crm/console/App.tsx` é o shell: sessão, permissões, seleção de unidade, navegação, layout, design system e montagem do módulo ativo. O registro manual foi movido para `crm/console/modules/registry.tsx`.

Cada manifesto declara chave, rótulo, entrypoint, bundle lazy, permissão, comando de teste e estado de indisponibilidade. `ModuleSlot` aplica `Suspense` e `ErrorBoundary` por módulo, portanto falha de chunk/renderização não derruba o shell nem outro módulo já carregado.

Não há microfrontends, federation, runtime remoto ou novo pipeline de publicação nesta etapa. Os módulos continuam no mesmo artefato CRM, com separação lógica e bundles lazy. A próxima extração progressiva é mover os cabeçalhos específicos que ainda vivem no shell para slots declarados pelos manifestos, preservando os bridges existentes.

# Shell lógico do CRM e módulos carregados sob demanda

O shell em `crm/console/App.tsx` conserva autenticação, seleção de unidade,
navegação, permissões de navegação, layout e contexto de cabeçalho. Os módulos
são declarados em `crm/console/modules/registry.tsx` com identificador, rótulo,
permissão, entrypoint lazy, fallback e estado de indisponibilidade.

`ModuleHost` cria uma fronteira de runtime por módulo. Falha de renderização ou
de chunk é limitada ao módulo ativo, oferece recuperação e mantém a navegação e
os demais módulos disponíveis. A autorização de dados continua nos backends.

Não há Module Federation, carregamento remoto ou deploy independente de bundles
nesta fase. Antes de evoluir a publicação independente, staging deve provar a
navegação entre Atendimento e Insumos, uma falha simulada de import e o retorno
pela barra lateral sem recarregar o shell.

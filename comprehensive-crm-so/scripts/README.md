# 📦 Scripts de Desenvolvimento

Esta pasta contém scripts reutilizáveis para desenvolvimento e manutenção do monorepo.

## Scripts Disponíveis

### `clean-all.sh`
Remove todos os node_modules, dist, .turbo e outros artifacts de build.

```bash
npm run clean
# ou diretamente
./scripts/clean-all.sh
```

### `setup-dev.sh`
Configura o ambiente de desenvolvimento completo.

```bash
./scripts/setup-dev.sh
```

### `lint-all.sh`
Executa linting em todos os packages.

```bash
npm run lint
# ou diretamente
./scripts/lint-all.sh
```

### `build-all.sh`
Faz build de todos os packages na ordem correta.

```bash
npm run build
# ou diretamente
./scripts/build-all.sh
```

## Estrutura de Scripts

```
scripts/
├── clean-all.sh        # Limpeza completa
├── setup-dev.sh        # Setup de desenvolvimento
├── lint-all.sh         # Linting completo
├── build-all.sh        # Build completo
├── check-deps.sh       # Verificação de dependências
└── migrate-legacy.sh   # Migração de código legado
Estes scripts são utilizados nos workflows de CI/CD para garantir consistência entre desenvolvimento local e automação.

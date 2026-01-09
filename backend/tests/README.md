## Tests (backend)

Este diretório contém testes automatizados (pytest) e scripts manuais.

### Pytest
- Testes automatizados ficam em `backend/tests/unit/`.
- Para rodar: `python3 -m pytest backend/tests/unit`

### Scripts manuais (smoke)
- Scripts que **podem chamar APIs reais** ou dependem de ambiente/config local ficam em `backend/tests/manual/`.
- Eles não são coletados pelo pytest (nomes não começam com `test_`).

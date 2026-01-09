from __future__ import annotations
import csv
from pathlib import Path
from typing import List, Union
from .models import Participante

REQUIRED_COLUMNS = [
    'nome','email','telefone','time','aniversario','cpf','genero','categoria','camiseta','nome_equipe'
]

def carregar_participantes_csv(path: Union[str, Path]) -> List[Participante]:
    path = Path(path)
    with path.open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
        if missing:
            raise ValueError(f'Colunas faltando no CSV: {missing}')
        participantes = []
        for row in reader:
            participantes.append(Participante(**row))
    return participantes

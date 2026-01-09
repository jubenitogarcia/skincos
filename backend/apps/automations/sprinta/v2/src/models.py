from __future__ import annotations
from pydantic import BaseModel, Field, EmailStr
from typing import Literal

Genero = Literal['m','f']
Categoria = Literal['10KM','5KM','3KM']
Camiseta = Literal['P','M','G','GG','EXG','Camiseta Baby M']

class Participante(BaseModel):
    nome: str = Field(..., alias='nome')
    email: EmailStr
    telefone: str
    time: str
    aniversario: str  # formato dd/mm/aaaa (validar posteriormente)
    cpf: str
    genero: Genero
    categoria: Categoria
    camiseta: Camiseta
    nome_equipe: str

    class Config:
        populate_by_name = True
        str_strip_whitespace = True

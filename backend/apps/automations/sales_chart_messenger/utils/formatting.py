#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Funções de formatação e conversão de dados.
"""
import logging
from typing import Union, Optional, Any
from .data_sanitizer import sanitize_sheet_value

def safe_float_convert(val):
    """Converte valor para float com segurança"""
    try:
        if isinstance(val, str):
            # Remove caracteres de formatação comum
            val = val.replace('R$', '').replace('.', '').replace(',', '.').strip()
        return float(val)
    except (ValueError, TypeError, AttributeError):
        return 0.0

def format_percentage(val, decimals=1):
    """Formata valor como percentual"""
    try:
        value = safe_float_convert(val)
        return f"{value:.{decimals}f}%"
    except Exception:
        return str(val)

def clean_text(text):
    """Remove caracteres especiais e normaliza texto usando sanitização avançada"""
    if not isinstance(text, str):
        return str(text)

    # Usar a função de sanitização mais robusta
    return sanitize_sheet_value(text)

def truncate_text(text, max_length=50, suffix="..."):
    """Trunca texto se muito longo"""
    if not isinstance(text, str):
        text = str(text)

    if len(text) <= max_length:
        return text

    return text[:max_length - len(suffix)] + suffix

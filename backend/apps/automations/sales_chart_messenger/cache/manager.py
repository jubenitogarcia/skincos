"""
Gerenciador centralizado de cache com configurações otimizadas.
"""

import time
from typing import Dict, Any, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

class CacheManager:
    """Gerenciador centralizado de cache"""
    _instance = None
    _cache = None

    # Configurações centralizadas
    DEFAULT_TTL = 300  # 5 minutos
    MAX_CACHE_SIZE = 1000
    CLEANUP_THRESHOLD = 0.8

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CacheManager, cls).__new__(cls)
            cls._cache = {}
        return cls._instance

    @classmethod
    def get_cache(cls) -> Dict[Tuple[str, ...], Dict[str, Any]]:
        """Retorna o cache global"""
        instance = cls()
        if instance._cache is None:
            instance._cache = {}
        return instance._cache

    @classmethod
    def get(cls, key: Tuple[str, ...]) -> Optional[Dict[str, Any]]:
        """Obtém item do cache se ainda válido"""
        cache = cls.get_cache()

        if key in cache:
            cached_data = cache[key]
            if time.time() - cached_data['timestamp'] < cached_data.get('ttl', cls.DEFAULT_TTL):
                logger.debug(f"🎯 Cache hit: {key}")
                return cached_data['data']
            else:
                # Remove entrada expirada
                del cache[key]
                logger.debug(f"🗑️ Cache expirado: {key}")

        return None

    @classmethod
    def set(cls, key: Tuple[str, ...], data: Any, ttl: Optional[int] = None) -> None:
        """Adiciona item ao cache com TTL opcional"""
        cache = cls.get_cache()

        # Limpar cache se necessário
        if len(cache) >= cls.MAX_CACHE_SIZE * cls.CLEANUP_THRESHOLD:
            cls._cleanup_cache()

        cache[key] = {
            'data': data,
            'timestamp': time.time(),
            'ttl': ttl or cls.DEFAULT_TTL
        }
        logger.debug(f"💾 Cache set: {key}")

    @classmethod
    def _cleanup_cache(cls) -> None:
        """Remove entradas expiradas do cache"""
        cache = cls.get_cache()
        current_time = time.time()

        # Remove entradas expiradas
        expired_keys = [
            key for key, value in cache.items()
            if current_time - value['timestamp'] >= value.get('ttl', cls.DEFAULT_TTL)
        ]

        for key in expired_keys:
            del cache[key]

        logger.debug(f"🧹 Cache cleanup: {len(expired_keys)} removidas")

    @classmethod
    def clear(cls):
        """Limpa todo o cache"""
        cache = cls.get_cache()
        cache.clear()
        logger.debug("🧹 Cache limpo completamente")

# Função auxiliar para compatibilidade
def get_cell_cache() -> Dict[Tuple[str, ...], Dict[str, Any]]:
    """Retorna o cache global, inicializando se necessário"""
    return CacheManager.get_cache()

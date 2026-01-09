"""
Sistema de automação principal com lógica de negócio.
"""

from .executor import AutomationExecutor
from .goals import GoalTracker
from .messages import MessageGenerator
from .downloads import ChartDownloader

__all__ = ['AutomationExecutor', 'GoalTracker', 'MessageGenerator', 'ChartDownloader']

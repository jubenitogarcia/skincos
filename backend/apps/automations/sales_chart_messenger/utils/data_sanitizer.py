"""
Utilities for sanitizing data from external sources.
"""

import logging

logger = logging.getLogger(__name__)

def sanitize_sheet_value(value):
    """
    Sanitizes a value from Google Sheets by removing unnecessary whitespace and characters.

    Args:
        value: The value to sanitize (string, number, or other type)

    Returns:
        The sanitized value
    """
    # Only process strings
    if not isinstance(value, str):
        return value

    # Remove leading/trailing whitespace
    value = value.strip()

    # Replace multiple spaces with single space
    value = ' '.join(value.split())

    # Remove zero-width spaces and other invisible characters
    value = value.replace('\u200b', '')  # zero-width space
    value = value.replace('\u200c', '')  # zero-width non-joiner
    value = value.replace('\u200d', '')  # zero-width joiner
    value = value.replace('\ufeff', '')  # zero-width no-break space (BOM)
    value = value.replace('\u00a0', ' ')  # non-breaking space

    # Remove other problematic characters that can appear in Google Sheets
    value = value.replace('\r\n', ' ')  # Windows line breaks
    value = value.replace('\r', ' ')    # Mac line breaks
    value = value.replace('\n', ' ')    # Unix line breaks
    value = value.replace('\t', ' ')    # Tab characters

    # Final cleanup - remove multiple spaces again (in case line breaks created them)
    value = ' '.join(value.split())

    return value


def sanitize_sheet_data(data):
    """
    Recursively sanitizes all string values in data structures from Google Sheets.

    Args:
        data: A value, list, or dictionary to sanitize

    Returns:
        The sanitized data structure
    """
    if isinstance(data, str):
        return sanitize_sheet_value(data)
    elif isinstance(data, list):
        return [sanitize_sheet_data(item) for item in data]
    elif isinstance(data, dict):
        return {k: sanitize_sheet_data(v) for k, v in data.items()}
    else:
        return data


def sanitize_batch_values(values_dict):
    """
    Sanitizes a dictionary of cell values typically returned by Google Sheets batch operations.

    Args:
        values_dict: Dictionary with cell ranges as keys and values as data

    Returns:
        Sanitized values dictionary
    """
    sanitized = {}
    for cell_range, value in values_dict.items():
        sanitized[cell_range] = sanitize_sheet_value(value)

    return sanitized


def log_sanitization_stats(original_data, sanitized_data):
    """
    Logs statistics about the sanitization process for debugging purposes.

    Args:
        original_data: The original data before sanitization
        sanitized_data: The data after sanitization
    """
    if not isinstance(original_data, dict) or not isinstance(sanitized_data, dict):
        return

    changes_detected = 0
    total_values = len(original_data)

    for key in original_data:
        if key in sanitized_data and str(original_data[key]) != str(sanitized_data[key]):
            changes_detected += 1
            logger.debug(f"📝 Sanitizado '{key}': '{original_data[key]}' → '{sanitized_data[key]}'")

    if changes_detected > 0:
        logger.info(f"🧹 Sanitização aplicada: {changes_detected}/{total_values} valores limpos")
    else:
        logger.debug("✨ Nenhuma sanitização necessária - dados já estão limpos")

#!/usr/bin/env python3
"""Validate n8n workflow JSON files for basic structural integrity."""

from __future__ import annotations

import json
from pathlib import Path

WORKFLOWS_DIR = Path("n8n/workflows")


def node_names_and_ids(nodes: list[dict]) -> tuple[set[str], set[str], list[str]]:
    names: set[str] = set()
    ids: set[str] = set()
    errors: list[str] = []

    for idx, node in enumerate(nodes):
        if not isinstance(node, dict):
            errors.append(f"node[{idx}] is not an object")
            continue

        name = str(node.get("name", "")).strip()
        node_id = str(node.get("id", "")).strip()
        node_type = str(node.get("type", "")).strip()

        if not name:
            errors.append(f"node[{idx}] missing 'name'")
        if not node_id:
            errors.append(f"node[{idx}] missing 'id'")
        if not node_type:
            errors.append(f"node[{idx}] missing 'type'")

        if name:
            if name in names:
                errors.append(f"duplicate node name: {name}")
            names.add(name)
        if node_id:
            if node_id in ids:
                errors.append(f"duplicate node id: {node_id}")
            ids.add(node_id)

    return names, ids, errors


def validate_connections(connections: dict, valid_node_names: set[str]) -> list[str]:
    errors: list[str] = []

    for source_name, payload in connections.items():
        if source_name not in valid_node_names:
            errors.append(f"connection source references unknown node: {source_name}")
        if not isinstance(payload, dict):
            errors.append(f"connection payload for '{source_name}' is not an object")
            continue

        main = payload.get("main")
        if main is None:
            continue
        if not isinstance(main, list):
            errors.append(f"connection main for '{source_name}' is not a list")
            continue

        for branch in main:
            if branch is None:
                continue
            if not isinstance(branch, list):
                errors.append(f"connection branch for '{source_name}' is not a list")
                continue
            for edge in branch:
                if not isinstance(edge, dict):
                    errors.append(f"connection edge for '{source_name}' is not an object")
                    continue
                target = str(edge.get("node", "")).strip()
                if not target:
                    errors.append(f"connection edge for '{source_name}' missing target node")
                    continue
                if target not in valid_node_names:
                    errors.append(
                        f"connection edge for '{source_name}' targets unknown node: {target}"
                    )

    return errors


def validate_file(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"invalid JSON: {exc}"]

    if not isinstance(raw, dict):
        return ["root must be an object"]

    name = str(raw.get("name", "")).strip()
    if not name:
        errors.append("missing workflow 'name'")

    nodes = raw.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        errors.append("missing or empty 'nodes' array")
        nodes = []

    connections = raw.get("connections")
    if not isinstance(connections, dict):
        errors.append("missing or invalid 'connections' object")
        connections = {}

    node_names, _node_ids, node_errors = node_names_and_ids(nodes)
    errors.extend(node_errors)
    errors.extend(validate_connections(connections, node_names))

    return errors


def main() -> int:
    workflow_files = sorted(WORKFLOWS_DIR.glob("*.json"))
    if not workflow_files:
        print(f"No workflow JSON files found in {WORKFLOWS_DIR}")
        return 1

    has_error = False
    for wf in workflow_files:
        errs = validate_file(wf)
        if errs:
            has_error = True
            print(f"[ERROR] {wf}")
            for err in errs:
                print(f"  - {err}")
        else:
            print(f"[OK] {wf}")

    if has_error:
        print("n8n workflow validation failed.")
        return 1

    print(f"n8n workflow validation passed for {len(workflow_files)} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

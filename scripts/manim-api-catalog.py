"""Emit a machine-readable API catalog for the installed Manim runtime."""

from __future__ import annotations

import contextlib
import importlib
import inspect
import json
import pkgutil
import re
import sys
import types
from collections import defaultdict
from typing import Any

import manim


DOC_LIMIT = 700


def safe_signature(value: Any) -> str | None:
    try:
        return str(inspect.signature(value))
    except (TypeError, ValueError):
        return None


def short_doc(value: Any) -> str | None:
    try:
        doc = inspect.getdoc(value)
    except Exception:
        return None
    if not doc:
        return None
    paragraph = re.split(r"\n\s*\n", doc.strip(), maxsplit=1)[0]
    normalized = re.sub(r"\s+", " ", paragraph).strip()
    return normalized[:DOC_LIMIT] or None


def value_kind(value: Any) -> str:
    if inspect.isclass(value):
        return "class"
    if inspect.isfunction(value) or inspect.isbuiltin(value):
        return "function"
    if inspect.ismodule(value):
        return "module"
    return "constant"


def member_kind(raw: Any, resolved: Any) -> str:
    if isinstance(raw, property):
        return "property"
    if isinstance(raw, staticmethod):
        return "staticmethod"
    if isinstance(raw, classmethod):
        return "classmethod"
    if inspect.isroutine(resolved) or callable(resolved):
        return "method"
    return "attribute"


def serialize_members(cls: type) -> dict[str, dict[str, Any]]:
    members: dict[str, dict[str, Any]] = {}
    for name in sorted(vars(cls)):
        if name.startswith("_"):
            continue
        try:
            raw = inspect.getattr_static(cls, name)
            resolved = getattr(cls, name)
        except Exception:
            continue

        callable_value = raw.__func__ if isinstance(raw, (staticmethod, classmethod)) else resolved
        record: dict[str, Any] = {
            "kind": member_kind(raw, resolved),
            "owner": f"{cls.__module__}.{cls.__qualname__}",
        }
        signature = safe_signature(callable_value)
        if signature:
            record["signature"] = signature
        doc = short_doc(resolved)
        if doc:
            record["doc"] = doc
        members[name] = record
    return members


def discover_modules() -> tuple[list[types.ModuleType], dict[str, str]]:
    modules: list[types.ModuleType] = [manim]
    errors: dict[str, str] = {}
    prefix = f"{manim.__name__}."

    for module_info in pkgutil.walk_packages(manim.__path__, prefix=prefix):
        name = module_info.name
        if any(part.startswith("_") or part in {"tests", "test"} for part in name.split(".")):
            continue
        try:
            with contextlib.redirect_stdout(sys.stderr):
                modules.append(importlib.import_module(name))
        except BaseException as error:  # Catalog generation must survive optional modules.
            errors[name] = f"{type(error).__name__}: {error}"
    return modules, errors


def discover_public_objects(modules: list[types.ModuleType]) -> list[tuple[str, Any]]:
    discovered: list[tuple[str, Any]] = []
    seen_paths: set[str] = set()

    for module in modules:
        module_name = module.__name__
        module_path = module_name
        if module_path not in seen_paths:
            discovered.append((module_path, module))
            seen_paths.add(module_path)

        for name, value in vars(module).items():
            if name.startswith("_"):
                continue

            kind = value_kind(value)
            defined_here = getattr(value, "__module__", None) == module_name
            top_level_export = module is manim
            public_constant = kind == "constant" and (top_level_export or name.isupper())
            if not (defined_here or top_level_export or public_constant):
                continue

            path = f"{module_name}.{name}"
            if path not in seen_paths:
                discovered.append((path, value))
                seen_paths.add(path)
    return discovered


def canonical_path(paths: list[str]) -> str:
    return min(paths, key=lambda path: (0 if path.count(".") == 1 else 1, len(path), path))


def build_catalog() -> dict[str, Any]:
    modules, module_errors = discover_modules()
    discovered = discover_public_objects(modules)
    object_paths: dict[int, list[str]] = defaultdict(list)
    object_values: dict[int, Any] = {}
    standalone: list[tuple[str, Any]] = []

    for path, value in discovered:
        kind = value_kind(value)
        if kind in {"class", "function", "module"}:
            object_paths[id(value)].append(path)
            object_values[id(value)] = value
        else:
            standalone.append((path, value))

    symbols: dict[str, dict[str, Any]] = {}
    alias_index: dict[str, str] = {}

    for object_id, paths in object_paths.items():
        value = object_values[object_id]
        canonical = canonical_path(paths)
        kind = value_kind(value)
        record: dict[str, Any] = {
            "name": canonical.rsplit(".", 1)[-1],
            "path": canonical,
            "kind": kind,
            "aliases": sorted(path for path in paths if path != canonical),
        }
        signature = safe_signature(value)
        if signature:
            record["signature"] = signature
        doc = short_doc(value)
        if doc:
            record["doc"] = doc
        if kind == "class":
            record["mro"] = [f"{base.__module__}.{base.__qualname__}" for base in value.__mro__]
            record["members"] = serialize_members(value)
        symbols[canonical] = record
        alias_index[canonical] = canonical
        for alias in record["aliases"]:
            alias_index[alias] = canonical

    for path, value in standalone:
        rendered = repr(value)
        symbols[path] = {
            "name": path.rsplit(".", 1)[-1],
            "path": path,
            "kind": "constant",
            "value": rendered[:300],
            "aliases": [],
        }
        alias_index[path] = path

    return {
        "schemaVersion": 1,
        "manimVersion": manim.__version__,
        "pythonVersion": sys.version.split()[0],
        "moduleCount": len(modules),
        "moduleErrors": module_errors,
        "symbols": symbols,
        "aliasIndex": alias_index,
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    json.dump(build_catalog(), sys.stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

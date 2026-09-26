"""Emit a machine-readable API catalog for the installed matplotlib runtime.

Behavioural reference: scripts/manim-api-catalog.py (read-only). This script is
standalone and imports nothing from it. It performs catalog introspection only:
no user input is ever executed, no window is opened, and every optional module
failure is captured instead of aborting the catalog.
"""

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

PACKAGE_NAME = "matplotlib"
DOC_LIMIT = 700
VALUE_LIMIT = 300

# Explicitly included even when package walking fails, because these carry the
# public API surface a Plot Studio session actually references.
CORE_MODULES = (
    "matplotlib.pyplot",
    "matplotlib.axes",
    "matplotlib.figure",
    "matplotlib.artist",
    "matplotlib.lines",
    "matplotlib.patches",
    "matplotlib.text",
    "matplotlib.colors",
    "matplotlib.ticker",
    "matplotlib.gridspec",
    "matplotlib.image",
    "matplotlib.legend",
    "matplotlib.axis",
    "matplotlib.cm",
    "matplotlib.dates",
    "matplotlib.markers",
    "matplotlib.path",
    "matplotlib.transforms",
    "matplotlib.widgets",
    "matplotlib.animation",
    "matplotlib.contour",
    "matplotlib.collections",
    "matplotlib.patheffects",
    "matplotlib.scale",
    "matplotlib.spines",
    "matplotlib.style",
    "matplotlib.rcsetup",
    "matplotlib.tri",
    "matplotlib.stackplot",
    "matplotlib.streamplot",
    "matplotlib.table",
    "matplotlib.offsetbox",
    "matplotlib.quiver",
    "matplotlib.sankey",
    "matplotlib.tight_layout",
    "matplotlib.units",
    "matplotlib.container",
    "matplotlib.font_manager",
    "matplotlib.backends.backend_agg",
    "matplotlib.backends.backend_svg",
    "matplotlib.backends.backend_pdf",
)

SKIPPED_SEGMENTS = {"tests", "test", "testing"}


def safe_signature(value: Any) -> str | None:
    try:
        return str(inspect.signature(value))
    except Exception:
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


def module_name_of(value: Any) -> str | None:
    try:
        module_name = getattr(value, "__module__", None)
    except Exception:
        return None
    return module_name if isinstance(module_name, str) else None


def is_package_owned(value: Any) -> bool:
    module_name = module_name_of(value)
    return bool(module_name) and module_name.startswith(f"{PACKAGE_NAME}.")


def preferred_module_name(module_name: str) -> str:
    """Map `matplotlib.axes._axes` to the public module `matplotlib.axes`."""
    parts = module_name.split(".")
    return ".".join([parts[0], *[part for part in parts[1:] if not part.startswith("_")]])


def is_skipped_module(name: str) -> bool:
    parts = name.split(".")
    return any(part.startswith("_") or part in SKIPPED_SEGMENTS for part in parts)


def serialize_members(cls: type, owner_path: str) -> dict[str, dict[str, Any]]:
    members: dict[str, dict[str, Any]] = {}
    try:
        names = sorted(vars(cls))
    except Exception:
        return members

    for name in names:
        if name.startswith("_"):
            continue
        try:
            raw = inspect.getattr_static(cls, name)
            resolved = getattr(cls, name)
        except Exception:
            continue

        callable_value = raw.__func__ if isinstance(raw, (staticmethod, classmethod)) else resolved
        record: dict[str, Any] = {"kind": member_kind(raw, resolved), "owner": owner_path}
        signature = safe_signature(callable_value)
        if signature:
            record["signature"] = signature
        doc = short_doc(resolved)
        if doc:
            record["doc"] = doc
        members[name] = record
    return members


def discover_modules() -> tuple[list[types.ModuleType], dict[str, str]]:
    modules: list[types.ModuleType] = []
    errors: dict[str, str] = {}
    seen: set[str] = set()
    walk_errors: dict[str, str] = {}

    def load(name: str) -> None:
        if name in seen or is_skipped_module(name):
            return
        seen.add(name)
        try:
            with contextlib.redirect_stdout(sys.stderr):
                modules.append(importlib.import_module(name))
        except BaseException as error:  # Optional modules must not abort the catalog.
            errors[name] = f"{type(error).__name__}: {error}"

    try:
        with contextlib.redirect_stdout(sys.stderr):
            package = importlib.import_module(PACKAGE_NAME)
            package.use("Agg", force=True)  # Headless: no GUI, no interactive window.
    except BaseException as error:
        errors[PACKAGE_NAME] = f"{type(error).__name__}: {error}"
        return modules, errors

    seen.add(PACKAGE_NAME)
    modules.append(package)

    for name in CORE_MODULES:
        load(name)

    walked: list[str] = []
    with contextlib.redirect_stdout(sys.stderr):
        # Imports performed while walking must not pollute the JSON stdout channel.
        walked = sorted(
            info.name
            for info in pkgutil.walk_packages(
                package.__path__,
                prefix=f"{PACKAGE_NAME}.",
                onerror=lambda name: walk_errors.setdefault(name, "walk_packages could not descend"),
            )
        )
    for name in walked:
        load(name)

    errors.update({name: message for name, message in walk_errors.items() if name not in errors})
    return modules, errors


def discover_public_objects(modules: list[types.ModuleType]) -> list[tuple[str, Any]]:
    discovered: list[tuple[str, Any]] = []
    seen_paths: set[str] = set()

    for module in modules:
        module_name = module.__name__
        if module_name not in seen_paths:
            discovered.append((module_name, module))
            seen_paths.add(module_name)

        try:
            namespace = vars(module)
        except Exception:
            continue

        for name, value in namespace.items():
            if name.startswith("_"):
                continue

            kind = value_kind(value)
            if kind == "module":
                # Only matplotlib's own submodules are catalogued, never stdlib/third-party.
                if not isinstance(value, types.ModuleType) or not value.__name__.startswith(f"{PACKAGE_NAME}."):
                    continue
            else:
                # `defined_here` misses matplotlib's public re-exports (`matplotlib.axes.Axes`
                # lives in the private `matplotlib.axes._axes`), so package-owned re-exports
                # are accepted as public API.
                defined_here = module_name_of(value) == module_name
                if not (defined_here or is_package_owned(value) or name.isupper()):
                    continue

            path = f"{module_name}.{name}"
            if path in seen_paths:
                continue
            discovered.append((path, value))
            seen_paths.add(path)
    return discovered


def canonical_path(paths: list[str], value: Any) -> str:
    preferred = module_name_of(value)
    preferred = preferred_module_name(preferred) if preferred and preferred.startswith(f"{PACKAGE_NAME}.") else None

    def rank(path: str) -> tuple[int, int, int, str]:
        name = path.rsplit(".", 1)[-1]
        matches_owner = 0 if preferred and path == f"{preferred}.{name}" else 1
        return (matches_owner, 0 if path.count(".") == 1 else 1, len(path), path)

    return min(paths, key=rank)


def build_catalog() -> dict[str, Any]:
    modules, module_errors = discover_modules()
    discovered = discover_public_objects(modules)

    object_paths: dict[int, list[str]] = defaultdict(list)
    object_values: dict[int, Any] = {}
    standalone: list[tuple[str, Any]] = []
    canonical_by_id: dict[int, str] = {}
    symbols: dict[str, dict[str, Any]] = {}
    alias_index: dict[str, str] = {}
    auxiliary: dict[int, tuple[str, Any]] = {}

    def register(paths: list[str], value: Any, canonical: str) -> None:
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
            record["mro"] = [canonical, *[path for path in (base_path(base) for base in value.__mro__[1:]) if path]]
            record["members"] = serialize_members(value, canonical)
        symbols[canonical] = record
        alias_index[canonical] = canonical
        for alias in record["aliases"]:
            alias_index.setdefault(alias, canonical)

    def base_path(base: Any) -> str | None:
        """Resolve an MRO base to a catalog path, registering private public-ish bases."""
        key = id(base)
        if key in canonical_by_id:
            return canonical_by_id[key]
        if key in auxiliary:
            return auxiliary[key][0]
        module_name = module_name_of(base)
        qualname = getattr(base, "__qualname__", None)
        if not module_name or not isinstance(qualname, str):
            return None
        if not module_name.startswith(f"{PACKAGE_NAME}."):
            return None  # builtins.object and third-party bases stay out of the MRO list.
        path = f"{preferred_module_name(module_name)}.{qualname}"
        auxiliary[key] = (path, base)
        return path

    for path, value in discovered:
        if value_kind(value) in {"class", "function", "module"}:
            object_paths[id(value)].append(path)
            object_values[id(value)] = value
        else:
            standalone.append((path, value))

    for object_id, paths in object_paths.items():
        value = object_values[object_id]
        canonical = canonical_path(paths, value)
        canonical_by_id[object_id] = canonical
        register(paths, value, canonical)

    # MRO bases that only exist under private module names are registered under their
    # public-ified path so inherited member lookup can resolve them.
    while auxiliary:
        key = min(auxiliary, key=lambda candidate: auxiliary[candidate][0])
        path, base = auxiliary.pop(key)
        canonical_by_id[id(base)] = path
        if path in symbols:
            continue
        aliases = [f"{module_name_of(base)}.{base.__qualname__}"] if module_name_of(base) else []
        register([path, *aliases], base, path)

    for path, value in standalone:
        try:
            rendered = repr(value)
        except Exception:
            continue
        symbols[path] = {
            "name": path.rsplit(".", 1)[-1],
            "path": path,
            "kind": "constant",
            "value": rendered[:VALUE_LIMIT],
            "aliases": [],
        }
        alias_index.setdefault(path, path)

    return {
        "schemaVersion": 1,
        "packageName": PACKAGE_NAME,
        "packageVersion": str(package_version(modules)),
        "pythonVersion": sys.version.split()[0],
        "moduleCount": len(modules),
        "moduleErrors": module_errors,
        "symbols": symbols,
        "aliasIndex": alias_index,
    }


def package_version(modules: list[types.ModuleType]) -> str:
    for module in modules:
        if module.__name__ == PACKAGE_NAME:
            return str(getattr(module, "__version__", "unknown"))
    return "unknown"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    json.dump(build_catalog(), sys.stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Extract ManimGX's installed Python API and reconcile the curated search catalog.

Run with the rendering venv's Python. This imports API definitions only: it never
constructs a scene, starts a GPU, or renders. The directory name `manim` is the
product mode's stable storage key; package metadata and API paths identify GX.
"""

import argparse
import ast
import hashlib
import importlib
import importlib.metadata
import inspect
import json
import platform
import re
import textwrap
import typing
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType


# Curated recall descriptions for native typesetting. Baseline facts always come
# from the installed package, independently of these search ranking descriptions.
NATIVE_SEARCH = {
    "manimgx.Typst": "typeset chinese prose and inline mathematics together",
    "manimgx.MathTypst": "typeset a mathematical formula using native typst syntax",
    "manimgx.MathTypst.select": "select a named group inside a mathematical formula",
    "manimgx.Typst.select": "select a labelled group inside typeset content",
    "manimgx.Typst.font_size": "resize typeset content while preserving its layout",
    "manimgx.Text": "display plain text with bundled multilingual fonts",
    "manimgx.DecimalNumber": "display a changing number without rebuilding a formula",
    "manimgx.mobjects.text.TypstOptions": "configure native typesetting appearance and font selection",
}
LEGACY_TYPESETTING = {
    "Tex", "MathTex", "SingleStringMathTex", "MathTexPart", "TexTemplate",
    "TexTemplateLibrary", "TexFontTemplates", "TransformMatchingTex",
    "matrix_to_tex_string", "tex_to_color_map", "tex_to_svg_file",
}


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def signature(value) -> str | None:
    try:
        if inspect.isclass(value) and value.__init__ is not object.__init__:
            # A class's generic __new__ can hide its constrained __init__ (Animation).
            constructor = inspect.signature(value.__init__)
            parameters = list(constructor.parameters.values())
            if parameters and parameters[0].name in ("self", "cls"):
                parameters = parameters[1:]
            result = str(constructor.replace(parameters=parameters))
        else:
            result = str(inspect.signature(value))
        # Runtime addresses are not API facts and must not churn committed data.
        return re.sub(r" at 0x[0-9A-Fa-f]+", "", result)
    except (TypeError, ValueError):
        return None


def keyword_schema(value) -> type | None:
    """Find the real TypedDict used by **kwargs, without calling the API."""
    target = value.__init__ if inspect.isclass(value) else value
    if isinstance(target, (staticmethod, classmethod)):
        target = target.__func__
    target = inspect.unwrap(target)
    try:
        parameters = inspect.signature(target).parameters.values()
    except (TypeError, ValueError):
        return None
    for parameter in parameters:
        if parameter.kind != inspect.Parameter.VAR_KEYWORD:
            continue
        annotation = parameter.annotation
        if isinstance(annotation, str):
            try:
                annotation = eval(annotation, getattr(target, "__globals__", {}))
            except (NameError, TypeError, SyntaxError):
                continue
        origin = typing.get_origin(annotation)
        if getattr(origin, "__name__", "") != "Unpack":
            continue
        options = typing.get_args(annotation)[0]
        if inspect.isclass(options) and hasattr(options, "__required_keys__"):
            return options
    return None


def annotation_text(annotation) -> str:
    if isinstance(annotation, str):
        return annotation
    if isinstance(annotation, typing.ForwardRef):
        return annotation.__forward_arg__
    return inspect.formatannotation(annotation)


def facts(value) -> dict:
    result = {}
    if (sig := signature(value)) is not None:
        result["signature"] = sig
    if doc := inspect.getdoc(value):
        result["doc"] = doc
    if options := keyword_schema(value):
        path = f"{options.__module__}.{options.__qualname__}"
        fields = ", ".join(sorted(options.__annotations__))
        result["doc"] = f"Keyword options: {path} ({fields}).\n\n" + result.get("doc", "")
    return result


def instance_fields(cls: type) -> set[str]:
    """Declared self fields, without executing constructors or inferring values."""
    try:
        source = ast.parse(textwrap.dedent(inspect.getsource(cls)))
    except (OSError, TypeError, IndentationError, SyntaxError):
        return set()
    declaration = next((node for node in source.body if isinstance(node, ast.ClassDef)), None)
    if declaration is None:
        return set()
    fields = set()
    for method in declaration.body:
        if not isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) or method.name != "__init__":
            continue
        for node in ast.walk(method):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
            for target in targets:
                for item in ast.walk(target):
                    if isinstance(item, ast.Attribute) and isinstance(item.value, ast.Name) and item.value.id == "self":
                        if not item.attr.startswith("_"):
                            fields.add(item.attr)
    return fields


def build_baseline(module: ModuleType) -> dict:
    exported = {name: value for name, value in vars(module).items() if not name.startswith("_")}
    # Nested module exports are real qualified names, not a second library's API.
    for name, value in list(exported.items()):
        if isinstance(value, ModuleType) and value.__name__.startswith("manimgx."):
            for child_name, child in vars(value).items():
                if not child_name.startswith("_") and getattr(child, "__module__", "").startswith("manimgx."):
                    exported[f"{name}.{child_name}"] = child

    classes: dict[type, list[str]] = {}
    for name, value in exported.items():
        if inspect.isclass(value) and getattr(value, "__module__", "").startswith("manimgx."):
            classes.setdefault(value, []).append(f"manimgx.{name}")
    # Keep non-exported ancestors as facts, so inherited members resolve correctly.
    for cls in list(classes):
        for parent in inspect.getmro(cls):
            if parent.__module__.startswith("manimgx.") and parent not in classes:
                classes[parent] = [f"{parent.__module__}.{parent.__qualname__}"]
    # Unpack schemas are part of a callable's contract even when the package root
    # does not re-export them. Retain their real module paths, never invent aliases.
    callables = list(exported.values()) + [member for cls in classes for member in vars(cls).values()]
    for value in callables:
        options = keyword_schema(value)
        if options is not None and options.__module__.startswith("manimgx.") and options not in classes:
            classes[options] = [f"{options.__module__}.{options.__qualname__}"]
    class_paths = {
        cls: min(paths, key=lambda path: (path.rsplit(".", 1)[-1] != cls.__name__, path.count("."), path))
        for cls, paths in classes.items()
    }

    symbols = {}
    aliases = {}
    for cls, paths in classes.items():
        canonical = class_paths[cls]
        all_paths = sorted(set(paths + [f"{cls.__module__}.{cls.__qualname__}"]))
        record = {
            "name": canonical.rsplit(".", 1)[-1], "path": canonical, "kind": "class",
            "aliases": all_paths, "mro": [class_paths.get(base, f"{base.__module__}.{base.__qualname__}") for base in inspect.getmro(cls)],
            **facts(cls),
        }
        members = {}
        declared = set(vars(cls)) | set(getattr(cls, "__annotations__", {})) | instance_fields(cls)
        for name in sorted(declared):
            if name.startswith("_") and name != "__init__":
                continue
            raw = vars(cls).get(name)
            member = {"owner": canonical, "kind": "attribute"}
            annotations = getattr(cls, "__annotations__", {})
            if name in annotations:
                member["signature"] = f"{name}: {annotation_text(annotations[name])}"
            if isinstance(raw, property):
                member.update(kind="property", **facts(raw.fget))
            elif isinstance(raw, staticmethod):
                member.update(kind="staticmethod", **facts(raw.__func__))
            elif isinstance(raw, classmethod):
                member.update(kind="classmethod", **facts(raw.__func__))
            elif inspect.isroutine(raw):
                member.update(kind="method", **facts(raw))
            members[name] = member
        if members:
            record["members"] = members
        symbols[canonical] = record
        for path in all_paths:
            aliases[path] = canonical

    for name, value in exported.items():
        if inspect.isclass(value):
            continue
        path = f"manimgx.{name}"
        if isinstance(value, ModuleType):
            if not value.__name__.startswith("manimgx."):
                continue
            kind = "module"
        elif inspect.isroutine(value):
            if not getattr(value, "__module__", "").startswith("manimgx."):
                continue
            kind = "function"
        else:
            kind = "constant"
        record = {"name": name.rsplit(".", 1)[-1], "path": path, "kind": kind, "aliases": [path]}
        if kind in ("function", "module"):
            record.update(facts(value))
        symbols[path] = record
        aliases[path] = path
    return {
        "schemaVersion": 1, "packageName": "manimgx",
        "packageVersion": importlib.metadata.version("manimgx"), "pythonVersion": platform.python_version(),
        "moduleCount": len({getattr(value, "__module__", "") for value in exported.values()} - {""}),
        "moduleErrors": {}, "symbols": dict(sorted(symbols.items())), "aliasIndex": dict(sorted(aliases.items())),
    }


def resolve(baseline: dict, reference: str) -> str | None:
    symbols, aliases = baseline["symbols"], baseline["aliasIndex"]
    if reference in aliases:
        return aliases[reference]
    parts = reference.split(".")
    for index in range(len(parts) - 1, 0, -1):
        owner = aliases.get(".".join(parts[:index]))
        if owner is None:
            continue
        member = ".".join(parts[index:])
        record = symbols[owner]
        if any(member in symbols.get(base, {}).get("members", {}) for base in record.get("mro", [owner])):
            return f"{owner}.{member}"
    return None


def validate_catalog(baseline: dict, search: dict[str, str]) -> None:
    """Reject inconsistent generated data before replacing committed artifacts."""
    for path, record in baseline["symbols"].items():
        if record["path"] != path or not path.startswith("manimgx."):
            raise ValueError(f"Invalid GX symbol path: {path}")
        for alias in record["aliases"]:
            if baseline["aliasIndex"].get(alias) != path:
                raise ValueError(f"Inconsistent alias: {alias} -> {path}")
        for name, member in record.get("members", {}).items():
            if member["owner"] not in baseline["symbols"]:
                raise ValueError(f"Unknown declaring class: {path}.{name}")
    for alias, canonical in baseline["aliasIndex"].items():
        if canonical not in baseline["symbols"]:
            raise ValueError(f"Unknown alias target: {alias} -> {canonical}")
    for key, sentence in search.items():
        if resolve(baseline, key) is None:
            raise ValueError(f"Unresolvable search key: {key}")
        if not re.fullmatch(r"[a-z0-9]+(?: [a-z0-9]+)*", sentence) or not 4 <= len(sentence.split()) <= 16:
            raise ValueError(f"Invalid search sentence: {key}: {sentence}")
        without_axis_roles = re.sub(r"\bthe [xyz] axis\b", "axis", sentence)
        if "the" in without_axis_roles.split():
            raise ValueError(f"Unnecessary article in search sentence: {key}: {sentence}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/api-catalog/manim"))
    args = parser.parse_args()
    module = importlib.import_module("manimgx")
    baseline = build_baseline(module)
    search_path = args.output / "search.json"
    previous = json.loads(search_path.read_text(encoding="utf-8"))
    search, removed = {}, []
    for old, sentence in previous.items():
        reference = old.replace("manim.", "manimgx.", 1) if old.startswith("manim.") else old
        description = sentence.lower()
        if any(part in LEGACY_TYPESETTING for part in reference.split(".")) or "latex" in description or "tex template" in description:
            removed.append(old)
            continue
        canonical = resolve(baseline, reference)
        if canonical is None:
            removed.append(old)
        else:
            search[canonical] = sentence
    for reference, sentence in NATIVE_SEARCH.items():
        canonical = resolve(baseline, reference)
        if canonical is None:
            raise RuntimeError(f"Installed ManimGX lacks a required typesetting API: {reference}")
        search[canonical] = sentence
    search = dict(sorted(search.items()))
    validate_catalog(baseline, search)
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "baseline.json", baseline)
    write_json(search_path, search)
    write_json(args.output / "manifest.json", {
        "schemaVersion": 1, "packageName": baseline["packageName"], "packageVersion": baseline["packageVersion"],
        "pythonVersion": baseline["pythonVersion"], "generatedAt": datetime.now(timezone.utc).isoformat(),
        "generatedBy": "scripts/build-manimgx-catalog.py",
        "counts": {"symbols": len(baseline["symbols"]), "aliases": len(baseline["aliasIndex"]),
                   "classes": sum(s["kind"] == "class" for s in baseline["symbols"].values()),
                   "members": sum(len(s.get("members", {})) for s in baseline["symbols"].values())},
        "files": {name: {"bytes": (args.output / name).stat().st_size,
                         "sha256": hashlib.sha256((args.output / name).read_bytes()).hexdigest()}
                  for name in ("baseline.json", "search.json")},
        "search": {"entries": len(search), "removed": removed, "unresolved": []},
    })
    print(f"ManimGX {baseline['packageVersion']}: {len(baseline['symbols'])} symbols, {len(search)} search entries; {len(removed)} obsolete search entries removed")
    print("Regenerate search vectors before restarting the backend: npm run build:search-vectors")


if __name__ == "__main__":
    main()

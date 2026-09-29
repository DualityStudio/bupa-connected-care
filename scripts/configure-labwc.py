#!/usr/bin/env python3
"""Add the kiosk key binding to an existing Labwc configuration."""

from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


START = "<!-- BUPA_SCREEN_KIOSK_KEYS_START -->"
END = "<!-- BUPA_SCREEN_KIOSK_KEYS_END -->"
PREFIX_PATTERN = r"(?P<prefix>[A-Za-z_][\w.-]*:)?"


def binding(indent: str, prefix: str = "") -> str:
    return "\n".join(
        (
            f"{indent}{START}",
            f'{indent}<{prefix}keybind key="C-A-F12">',
            f'{indent}  <{prefix}action name="Iconify" />',
            f"{indent}</{prefix}keybind>",
            f"{indent}{END}",
        )
    )


def remove_existing_binding(source: str) -> str:
    pattern = re.compile(
        rf"(?ms)^[ \t]*{re.escape(START)}.*?^[ \t]*{re.escape(END)}[ \t]*(?:\r?\n)?"
    )
    return pattern.sub("", source)


def add_binding(source: str) -> str:
    source = remove_existing_binding(source)

    closing_keyboard = re.search(
        rf"(?m)^(?P<indent>[ \t]*)</{PREFIX_PATTERN}keyboard\s*>", source
    )
    if closing_keyboard:
        indent = closing_keyboard.group("indent") + "  "
        prefix = closing_keyboard.group("prefix") or ""
        return (
            source[: closing_keyboard.start()]
            + binding(indent, prefix)
            + "\n"
            + source[closing_keyboard.start() :]
        )

    self_closing_keyboard = re.search(
        rf"(?m)^(?P<indent>[ \t]*)<{PREFIX_PATTERN}keyboard(?P<attrs>[^<>]*?)/>[ \t]*$",
        source,
    )
    if self_closing_keyboard:
        indent = self_closing_keyboard.group("indent")
        prefix = self_closing_keyboard.group("prefix") or ""
        attrs = self_closing_keyboard.group("attrs").rstrip()
        replacement = "\n".join(
            (
                f"{indent}<{prefix}keyboard{attrs}>",
                binding(indent + "  ", prefix),
                f"{indent}</{prefix}keyboard>",
            )
        )
        return source[: self_closing_keyboard.start()] + replacement + source[self_closing_keyboard.end() :]

    closing_elements = list(
        re.finditer(
            rf"(?m)^(?P<indent>[ \t]*)</{PREFIX_PATTERN}(?P<name>[A-Za-z_][\w.-]*)\s*>",
            source,
        )
    )
    if closing_elements:
        root = closing_elements[-1]
        indent = root.group("indent") + "  "
        prefix = root.group("prefix") or ""
        keyboard = "\n".join(
            (
                f"{indent}<{prefix}keyboard>",
                binding(indent + "  ", prefix),
                f"{indent}</{prefix}keyboard>",
                "",
            )
        )
        return source[: root.start()] + keyboard + source[root.start() :]

    self_closing_root = re.search(
        rf"(?m)^(?P<indent>[ \t]*)<{PREFIX_PATTERN}(?P<name>labwc_config|openbox_config)(?P<attrs>[^<>]*?)/>[ \t]*$",
        source,
    )
    if self_closing_root:
        indent = self_closing_root.group("indent")
        prefix = self_closing_root.group("prefix") or ""
        name = self_closing_root.group("name")
        attrs = self_closing_root.group("attrs").rstrip()
        replacement = "\n".join(
            (
                f"{indent}<{prefix}{name}{attrs}>",
                f"{indent}  <{prefix}keyboard>",
                binding(indent + "    ", prefix),
                f"{indent}  </{prefix}keyboard>",
                f"{indent}</{prefix}{name}>",
            )
        )
        return source[: self_closing_root.start()] + replacement + source[self_closing_root.end() :]

    raise ValueError("Could not find a Labwc configuration root or keyboard section")


def main() -> int:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} INPUT OUTPUT", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    try:
        updated = add_binding(input_path.read_text(encoding="utf-8"))
        ET.fromstring(updated)
        output_path.write_text(updated, encoding="utf-8")
    except (OSError, UnicodeError, ValueError, ET.ParseError) as error:
        print(f"Could not update Labwc configuration: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

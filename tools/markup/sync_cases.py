# -*- coding: utf-8 -*-
"""Зеркалирование набора случаев разметки в тесты бэкенда.

`stripRichText` на фронте и `_plain_text` на бэкенде объявлены зеркалами и обязаны давать один
результат на одном тексте. Держать это словами не вышло: за два дня зеркала разошлись дважды —
«^\\s*» съедал пустую строку перед списком, а «ближайшая пара звёздочек» превращала «5 * 4» в
«5  4», то есть знак умножения молча пропадал в тексте, уходящем в Bitrix.

Теперь обе стороны проверяются ОДНИМ набором случаев. Один файл обоим наборам тестов не виден:
vitest живёт в контейнере фронта (/app = RDProject/frontend), pytest — в контейнере бэкенда
(/app = pmo-backend), и каждый видит только своё. Поэтому источник один, а рядом с тестами
бэкенда лежит его зеркало.

    python tools/markup/sync_cases.py            # обновить зеркало
    python tools/markup/sync_cases.py --check    # проверить (код возврата 1 при расхождении)

Правится ТОЛЬКО источник: RDProject/frontend/src/utils/markupCases.json.
"""
import os
import shutil
import sys

_reconfigure = getattr(sys.stdout, "reconfigure", None)
if _reconfigure:
    _reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "RDProject", "frontend", "src", "utils", "markupCases.json")
DST = os.path.join(ROOT, "pmo-backend", "tests", "markup_cases.json")


def read(path):
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return f.read().replace(b"\r\n", b"\n")


def main() -> int:
    src = read(SRC)
    if src is None:
        print("SOURCE NOT FOUND: %s" % SRC)
        return 2
    if src == read(DST):
        print("MIRROR OK: %s" % DST)
        return 0
    if "--check" in sys.argv:
        print("MIRROR STALE: %s расходится с источником" % DST)
        print("Fix: python tools/markup/sync_cases.py")
        return 1
    shutil.copyfile(SRC, DST)
    print("MIRROR UPDATED: %s" % DST)
    return 0


if __name__ == "__main__":
    sys.exit(main())

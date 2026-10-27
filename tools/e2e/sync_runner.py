# -*- coding: utf-8 -*-
"""Зеркалирование спек Playwright в каталог-раннер.

ЗАЧЕМ ОТДЕЛЬНЫЙ КАТАЛОГ. `node_modules` фронта — контейнерные (Alpine): ставить их на хосте
нельзя (сломает vite в контейнере, браузеры Playwright под Alpine не ставятся). Поэтому тесты
гоняются из изолированного каталога на хосте, где стоит свой @playwright/test и браузеры.

ПОЧЕМУ ЗЕРКАЛО, А НЕ ПРЯМАЯ ССЫЛКА. Спеки импортируют `@playwright/test`, и Node ищет пакет
рядом с файлом — то есть в контейнерных node_modules фронта, где его нет. Заставить раннер
читать спеки прямо из репозитория можно только подсунув node_modules внутрь рабочего дерева;
это плата выше, чем копия. Поэтому копия — но СГЕНЕРИРОВАННАЯ, ровно как `.claude/skills`
зеркалит `.agents/skills`.

ЧЕМ ЭТО ЛУЧШЕ ПРЕЖНЕГО. Раньше копию правили руками, и она расходилась молча: два месяца
правок жили только на машине, вне гита, а в репозитории лежали тесты удалённых фич. Теперь
источник один — репозиторий, а `--check` показывает расхождение, не дожидаясь, пока кто-то
заметит его сам.

    python tools/e2e/sync_runner.py            # обновить зеркало
    python tools/e2e/sync_runner.py --check    # только проверить (код возврата 1 при расхождении)

Каталог раннера задаётся переменной PW_RUNNER, по умолчанию C:/pw-runner.
"""
import os
import shutil
import sys

# Консоль Windows по умолчанию cp1252, и русский вывод ронял скрипт на первой же строке —
# инструмент, который запускают руками, не имеет права падать из-за кодировки терминала.
_reconfigure = getattr(sys.stdout, "reconfigure", None)
if _reconfigure:
    _reconfigure(encoding="utf-8", errors="replace")

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                   "RDProject", "frontend", "e2e")
SRC = os.path.normpath(SRC)
DST = os.path.join(os.environ.get("PW_RUNNER", "C:/pw-runner"), "e2e")


def specs(folder):
    if not os.path.isdir(folder):
        return {}
    return {f: os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.endswith(".ts")}


def main() -> int:
    check = "--check" in sys.argv
    src, dst = specs(SRC), specs(DST)
    if not src:
        print("SOURCE NOT FOUND: %s" % SRC)
        return 2
    if not os.path.isdir(DST):
        # Каталога-раннера на этой машине нет — это не расхождение, а другая машина.
        # Молчаливый успех здесь честнее, чем «отстали все 15 файлов».
        print("RUNNER NOT HERE: %s (нечего зеркалить)" % DST)
        return 0

    add = [f for f in src if f not in dst]
    gone = [f for f in dst if f not in src]
    # Сравниваем ПО СОДЕРЖИМОМУ, а не по времени: переводы строк в рабочей копии могут быть
    # CRLF (core.autocrlf), и побайтовое сравнение файлов дало бы вечное «расходятся».
    diff = [f for f in src if f in dst and not same(src[f], dst[f])]

    if not (add or gone or diff):
        print("MIRROR OK: %d specs, %s" % (len(src), DST))
        return 0

    for f in add:
        print("  + %s (нет в раннере)" % f)
    for f in gone:
        print("  - %s (лишний в раннере: в репозитории такого нет)" % f)
    for f in diff:
        print("  ~ %s (содержимое разошлось)" % f)

    if check:
        print("MIRROR STALE: %d add, %d extra, %d changed" % (len(add), len(gone), len(diff)))
        print("Fix: python tools/e2e/sync_runner.py")
        return 1

    os.makedirs(DST, exist_ok=True)
    for f in add + diff:
        shutil.copyfile(src[f], os.path.join(DST, f))
    for f in gone:
        os.remove(dst[f])
    print("MIRROR UPDATED: %d copied, %d removed -> %s" % (len(add) + len(diff), len(gone), DST))
    return 0


def same(a, b):
    """Одинаковы ли файлы по содержимому, без оглядки на переводы строк."""
    with open(a, "rb") as fa, open(b, "rb") as fb:
        return fa.read().replace(b"\r\n", b"\n") == fb.read().replace(b"\r\n", b"\n")


if __name__ == "__main__":
    sys.exit(main())

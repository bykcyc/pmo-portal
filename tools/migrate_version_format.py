"""Одноразовая миграция: номер версии паспорта «5» → «1.0005».

Запускать ВНУТРИ контейнера бэкенда, из /app:
    python migrate_version_format.py            # показать, что будет сделано
    python migrate_version_format.py --apply    # применить

Почему не через SQL: meta лежит в колонке json, и любой round-trip через jsonb переставил бы
ключи — а порядок ключей входит в байт-контракт голден-эталонов. Идём теми же хелперами, что
и приложение: читаем, правим ОДНО поле, пишем обратно.

Пустой номер (проект, который ни разу не правили) оставляем пустым: «1.0000» соврало бы, что
редакция уже есть. Номер, уже приведённый к формату, не трогаем — скрипт идемпотентен.
"""
import asyncio
import re
import sys

import db
import main


async def run(apply: bool) -> None:
    await db.init_pool()
    rows = await db.fetch_project_rows()
    plan = []
    for row in rows:
        pid = str(row.get("id"))
        el, m = await main.load_meta(pid)
        raw = str(m.get("version") or "")
        if not raw:
            continue                      # ни разу не правили — номера нет и быть не должно
        if re.match(r"^\d+\.\d{4}$", raw):
            continue                      # уже в формате
        if not raw.isdigit():
            print("SKIP  %s: непонятный номер %r — трогать не буду" % (pid, raw))
            continue
        plan.append((pid, el, m, raw, main._format_version(1, int(raw))))

    if not plan:
        print("нечего мигрировать")
        return
    for pid, _e, _mm, old, new in plan:
        print("%s: %s -> %s" % (pid, old, new))
    if not apply:
        print("DRY-RUN, ничего не записано")
        return
    for pid, el, m, _old, new in plan:
        m["version"] = new
        await main.save_meta_full(pid, el, m)
    print("применено: %d" % len(plan))


asyncio.run(run("--apply" in sys.argv))

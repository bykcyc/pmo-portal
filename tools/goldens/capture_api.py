# -*- coding: utf-8 -*-
"""Golden-снапшоты API PMO-портала: побайтная фиксация всех GET-ответов.

Использование:
  python capture_api.py capture --base http://localhost:8001 --out api-v1
  python capture_api.py compare --base http://localhost:8002 --golden api-v1

capture: перечисляет маршруты из /openapi.json (включая динамические из
_register_collection), подставляет параметры из живых данных, сохраняет СЫРЫЕ
байты тел под двумя ролями (owner видит всё, pm1 — RBAC-скоуп + 403-контракт).
compare: повторяет ровно те же URL (из manifest.json) против другой базы и
диффает побайтно; несовпадения печатает со структурным json-диффом.

Волатильное: /metrics пропускается; в /me/calendar.ics нормализуется DTSTAMP.
Сравнение v1↔v2 проводить в ОДИН день (attention/trends зависят от today)
и при выключенном планировщике v2 (иначе trends получит свежую дату).
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import re
import sys
import urllib.request
import urllib.error

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CREDS = {
    "owner": {"email": "owner@company.com", "password": "admin123"},
    "pm1": {"email": "pm1@company.com", "password": "pm123"},
}

# GET-маршруты, которые не снимаем: шумные/бесконечные/не-контрактные.
# /projects/{pid}/action-log — ЖУРНАЛ активности: любая запись (в т.ч. e2e-прогон, который
# создаёт и удаляет задачу) дописывает в него строку и двигает байты. Это данные, а не контракт;
# держать его в эталоне значит красить гейт после каждого прогона тестов. Форма записи журнала
# покрыта pytest.
SKIP = {"/metrics", "/projects/{pid}/action-log",
        # Списки токенов помощника — тот же случай: каждый прогон e2e проходит OAuth и
        # оставляет ещё одну отозванную запись. Эталон устаревал после КАЖДОГО прогона
        # тестов, и два маршрута горели красным всегда. Форму покрывают pytest
        # (test_oauth_refresh, test_mcp_scopes).
        "/admin/agent-tokens", "/me/agent-tokens",
        # Dry-run буфер писем живёт в ПАМЯТИ процесса (mailer.OUTBOX) и очищается любым
        # рестартом бэкенда — гейт краснел после каждого перезапуска, а не после регрессии.
        "/admin/outbox"}

# Волатильные ПОЛЯ (глушим значение, структуру и порядок ключей сохраняем — они и есть контракт):
#  • bitrix_last_sync — авто-синк с Bitrix срабатывает при ОТКРЫТИИ проекта (троттл 15 мин),
#    поэтому простой просмотр страницы двигает байты /projects/{pid} и публичной share-выдачи;
#  • updated_at — как следствие той же записи.
# Без этого гейт невозможно удержать зелёным: его красит не регрессия, а факт, что кто-то
# посмотрел проект. Пропажу самого поля глушение НЕ скрывает — регекс не сматчится, байты уедут.
_VOLATILE_FIELDS = re.compile(rb'"(bitrix_last_sync|updated_at)":\s*"[^"]*"')


def _norm_volatile(body):
    return _VOLATILE_FIELDS.sub(rb'"\1":"NORM"', body)


def _norm_trends(body):
    """Ряд портфельных трендов — одна точка с заглушёнными значениями.

    Длина ряда НЕ является контрактом и удержать её невозможно: планировщик добавляет снимок
    каждую ночь, а окно в 90 дней однажды начнёт ронять точки и с начала. Эталон краснел от
    смены даты, а не от регрессии, — и это ровно тот случай, когда гейт учат игнорировать.

    Поэтому сверяем то, что и есть байтовый контракт: НАБОР и ПОРЯДОК ключей точки. Значения
    и количество точек — данные; их считает и проверяет pytest. Пустой ряд заглушка не скроет:
    точки не будет вовсе, и байты разойдутся.
    """
    try:
        doc = json.loads(body)
        rows = doc.get("data")
        if not isinstance(rows, list) or not rows or not isinstance(rows[-1], dict):
            return body
        doc["data"] = [{k: "NORM" for k in rows[-1]}]
        return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (ValueError, AttributeError):
        return body


# пост-обработка тел перед записью (нормализация волатильного)
NORMALIZERS = [
    (re.compile(r"^/me/calendar\.ics$"), lambda b: re.sub(rb"DTSTAMP:\d{8}T\d{6}Z", b"DTSTAMP:NORM", b)),
    (re.compile(r"^/portfolio/trends"), _norm_trends),
]


def http(base, path, token=None, timeout=30):
    req = urllib.request.Request(base + path)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def login(base, role):
    body = json.dumps(CREDS[role]).encode()
    req = urllib.request.Request(base + "/auth/login", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["access_token"]


def jget(base, path, token):
    st, b = http(base, path, token)
    if st != 200:
        return None
    try:
        d = json.loads(b)
        return d.get("data", d)
    except ValueError:
        return None


def discover_params(base, tokens, workers=12):
    """Собирает подстановки path-параметров из живых данных (под owner)."""
    t = tokens["owner"]
    projects = jget(base, "/projects?include_archived=true", t) or []
    pids = [str(p["id"]) for p in projects]
    p = {"pids": pids, "per_project": {}}

    def discover_one(pid):
        d = {}
        tasks = jget(base, f"/projects/{pid}/tasks", t) or []
        risks = jget(base, f"/projects/{pid}/risks", t) or []
        reports = jget(base, f"/projects/{pid}/status-reports", t) or []
        d["tid"] = str(tasks[0]["id"]) if tasks else None
        d["rid_risk"] = str(risks[0]["id"]) if risks else None
        d["rid_report"] = str(reports[0]["id"]) if reports else None
        # wpid для activity/attachments: задача и риск
        d["wpids"] = [x for x in (d["tid"], d["rid_risk"]) if x]
        # notes: первая сущность каждого типа с потенциальными заметками
        d["note_refs"] = []
        if risks:
            d["note_refs"].append(("risk", str(risks[0]["id"])))
        for coll, etype in (("decisions", "decision"), ("meetings", "meeting")):
            items = jget(base, f"/projects/{pid}/{coll}", t) or []
            if items:
                d["note_refs"].append((etype, str(items[0]["id"])))
        share = jget(base, f"/projects/{pid}/share", t) or {}
        d["share_token"] = share.get("token") if share.get("enabled") else None
        return pid, d

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for pid, d in executor.map(discover_one, pids):
            p["per_project"][pid] = d
    return p


def build_urls(base, tokens, workers=12):
    """Полный список (role, url) для снапшотов, из openapi.json + живых параметров."""
    st, body = http(base, "/openapi.json")
    if st != 200:
        print("FATAL: /openapi.json недоступен", file=sys.stderr)
        sys.exit(2)
    spec = json.loads(body)
    get_paths = sorted(p for p, ops in spec["paths"].items() if "get" in ops and p not in SKIP)
    prm = discover_params(base, tokens, workers)
    urls = []  # (role, url)

    def add(role, url):
        urls.append((role, url))

    for path in get_paths:
        if "{" not in path:
            # статические: под обеими ролями (RBAC-скоуп различается)
            add("owner", path)
            add("pm1", path)
            if path == "/search":
                for q in ("Web", "риск", "e2e"):
                    add("owner", f"/search?q={urllib.request.quote(q)}")
            if path == "/portfolio/dashboard":
                add("owner", path + "?include_archived=true")
            if path == "/portfolio/risks":
                add("owner", path + "?probability=high&impact=high")
            if path == "/projects":
                add("owner", path + "?include_archived=true")
            continue
        # параметризованные — раскрываем по всем проектам (owner) + 2 проекта под pm1
        if "{pid}" in path:
            for pid in prm["pids"]:
                d = prm["per_project"][pid]
                u = path.replace("{pid}", pid)
                if "{" not in u:
                    add("owner", u)
                    continue
                if "{wpid}" in u:
                    for w in d["wpids"]:
                        add("owner", u.replace("{wpid}", w))
                elif "{rid}" in u and "status-reports" in u:
                    if d["rid_report"]:
                        add("owner", u.replace("{rid}", d["rid_report"]))
                elif "{etype}" in u:
                    for etype, eid in d["note_refs"]:
                        add("owner", u.replace("{etype}", etype).replace("{eid}", eid))
                # attachments {aid} — вложений в данных ~0; контракт скачивания проверяется e2e
        elif "{token}" in path:
            for pid in prm["pids"]:
                tok = prm["per_project"][pid]["share_token"]
                if tok:
                    add(None, path.replace("{token}", tok))  # публичный, без auth
        # RBAC-контраст: pm1 на 2 проектах (свой 47 → 200, скоуп-поведение)
    for pid in ("47", "5"):
        if pid in prm["per_project"]:
            add("pm1", f"/projects/{pid}/tasks")
            add("pm1", f"/projects/{pid}/summary")
    return urls, prm


def fname(role, url):
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", url.strip("/")) or "root"
    return f"{role or 'public'}__{safe}.bin"


def normalize(url, body):
    body = _norm_volatile(body)          # глушим волатильные поля во ВСЕХ телах, не только JSON-роутов
    for rx, fn in NORMALIZERS:
        if rx.match(url.split("?")[0]):
            return fn(body)
    return body


def cmd_capture(args):
    base = args.base.rstrip("/")
    tokens = {r: login(base, r) for r in CREDS}
    urls, prm = build_urls(base, tokens, args.workers)
    os.makedirs(args.out, exist_ok=True)
    results = [None] * len(urls)

    def capture_one(index, role, url):
        st, body = http(base, url, tokens.get(role))
        body = normalize(url, body)
        fn = fname(role, url)
        return index, body, {"role": role, "url": url, "status": st, "file": fn, "size": len(body)}

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(capture_one, i, role, url) for i, (role, url) in enumerate(urls)]
        for done, future in enumerate(as_completed(futures), 1):
            i, body, entry = future.result()
            results[i] = (body, entry)
            if done % 100 == 0 or done == len(urls):
                print(f"progress: {done}/{len(urls)}", flush=True)

    manifest = []
    for body, entry in results:
        fn = entry["file"]
        with open(os.path.join(args.out, fn), "wb") as f:
            f.write(body)
        manifest.append(entry)
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"base": base, "routes": manifest}, f, ensure_ascii=False, indent=1)
    n200 = sum(1 for m in manifest if m["status"] == 200)
    print(f"captured {len(manifest)} responses ({n200} × 200, {len(manifest)-n200} × non-200) -> {args.out}")


def _jdiff(a, b, path="$", out=None, limit=25):
    """Компактный структурный дифф для читаемости отчёта."""
    if out is None:
        out = []
    if len(out) >= limit:
        return out
    if type(a) is not type(b):
        out.append(f"{path}: тип {type(a).__name__} -> {type(b).__name__}")
    elif isinstance(a, dict):
        for k in a.keys() | b.keys():
            if k not in a:
                out.append(f"{path}.{k}: ДОБАВЛЕН")
            elif k not in b:
                out.append(f"{path}.{k}: ПРОПАЛ")
            else:
                _jdiff(a[k], b[k], f"{path}.{k}", out, limit)
        if list(a.keys()) != list(b.keys()) and a.keys() == b.keys():
            out.append(f"{path}: ПОРЯДОК КЛЮЧЕЙ изменился")
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(f"{path}: длина {len(a)} -> {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            _jdiff(x, y, f"{path}[{i}]", out, limit)
    elif a != b:
        out.append(f"{path}: {a!r} -> {b!r}")
    return out


def cmd_compare(args):
    base = args.base.rstrip("/")
    with open(os.path.join(args.golden, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)["routes"]
    tokens = {r: login(base, r) for r in CREDS}
    results = [None] * len(manifest)

    def compare_one(index, m):
        try:
            st, body = http(base, m["url"], tokens.get(m["role"]) if m["role"] else None)
            body = normalize(m["url"], body)
            with open(os.path.join(args.golden, m["file"]), "rb") as f:
                gold = f.read()
            if st != m["status"]:
                return index, [f"FAIL [{m['role']}] {m['url']}: status {m['status']} -> {st}"]
            if body == gold:
                return index, []
            lines = [f"FAIL [{m['role']}] {m['url']}: тело различается ({len(gold)}b -> {len(body)}b)"]
            try:
                lines.extend(f"    {line}" for line in _jdiff(json.loads(gold), json.loads(body)))
            except ValueError:
                lines.append("    (не-JSON тело)")
            return index, lines
        except Exception as exc:  # noqa: BLE001 - harness must report the route and continue
            return index, [f"FAIL [{m['role']}] {m['url']}: {type(exc).__name__}: {exc}"]

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(compare_one, i, m) for i, m in enumerate(manifest)]
        for done, future in enumerate(as_completed(futures), 1):
            i, lines = future.result()
            results[i] = lines
            if done % 100 == 0 or done == len(manifest):
                print(f"progress: {done}/{len(manifest)}", flush=True)

    fail = sum(bool(lines) for lines in results)
    for lines in results:
        for line in lines:
            print(line)
    ok = len(manifest) - fail
    print(f"\n{'ЗЕЛЕНО' if fail == 0 else 'КРАСНО'}: {ok}/{len(manifest)} совпало, {fail} расхождений")
    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("--base", default="http://localhost:8001")
    c.add_argument("--out", default="api-v1")
    c.add_argument("--workers", type=int, default=12)
    c.set_defaults(fn=cmd_capture)
    d = sub.add_parser("compare")
    d.add_argument("--base", default="http://localhost:8002")
    d.add_argument("--golden", default="api-v1")
    d.add_argument("--workers", type=int, default=12)
    d.set_defaults(fn=cmd_compare)
    a = ap.parse_args()
    a.fn(a)

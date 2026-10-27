# PMO backend invariants

This service is the canonical PostgreSQL implementation used by `RDProject/frontend`.
It is not an OpenProject adapter; OpenProject-shaped dictionaries are internal compatibility shims.

## Do not change accidentally

- IDs in API payloads are strings even when PostgreSQL stores `BIGINT`.
- Date-like schema fields remain `TEXT`; converting them changes ordering and serialized bytes.
- JSON columns remain `json`, not `jsonb`, because key order is part of the golden contract.
- Work-package/task/risk shims, collection ordering, null/default handling, and the 60 KiB metadata limit are compatibility behavior.
- Project metadata must not regain task/risk counts or baselines. Those values belong in normalized tables and scoped queries.
- The collections `_action_log`/`_meetings`/`_backlog`/`_notes` are normalized into the `project_docs(project_id, coll, seq, doc json)` table — they must NOT return to `projects.meta`. Readers get them merged into `m` via `load_meta`/`fetch_projects` (which attach `row["_docs"]`); a direct `db.get_project_row` + `_meta` path that reads any of these must attach docs first (`db.load_project_docs`). Writers go through `save_meta_full`/`with_meta_retry` (which pass `extract_colls`); a direct `db.update_project_meta` call that changes them must pass `colls=` so the write lands in the same version-checked transaction.

## Идентичность людей (WP1) и Bitrix (WP5–WP6)

- **`persons` — канонический реестр людей.** В нём И email, И `bitrix24_id`; `USERS` — только
  логины портала. Задача хранит `assignee_person_id`, а `assignee_name`/`assignee_email`
  **заполняет сервер** (`_task_identity_fields`) — клиент их не диктует.
- **Никогда не гадаем, кто имелся в виду.** `resolve_person`: id → email → имя, причём по имени
  только УНИКАЛЬНОЕ совпадение. Роли-исполнители из импорта («IT lead», «Отдел контента», «РП»)
  остаются свободным текстом — это осознанное решение, лучше пусто, чем не тот человек.
  Исключение — `_my_task_match` (только ЧТЕНИЕ «моих задач»): там сравнение мягче, без диакритики.
- **Синк людей деактивирует только после ПОЛНОГО обхода Bitrix** (`_sync_bitrix_people`).
  `bx_call` отличает «Bitrix ответил пусто» от «Bitrix не ответил»; при частичной выборке
  `complete=False` и не деактивируется никто. Иначе один таймаут = массовое увольнение.
  Синк идемпотентен побайтово: без изменений он не пишет ВООБЩЕ (иначе ночная джоба двигала
  бы байты `/persons` каждую ночь и голден-гейт краснел бы навсегда).
- **`users.is_active` синк не трогает никогда** — это лок-аут портала в обход админского гарда.
- **Эхо-петля Bitrix** гасится в БД, а не в памяти (переживает второй воркер): вебхук
  пропускает событие, если статус уже наш ИЛИ код в Bitrix равен `tasks.bx_status` — тому,
  что мы сами туда положили. Второй рубеж обязателен: маппинг не биекция (on_hold и cancelled
  оба → «Отложена»). Колонка `bx_status` намеренно ВНЕ `_TASK_EXTRA_COLS` → наружу не уходит.
- **Исходящий push вешать только на РОУТ** (`tasks_routes` PUT), никогда на `db.update_task`:
  входящий вебхук пишет статус именно туда, напрямую — получилось бы кольцо.
- **Занятость календаря наружу — только интервалы.** Bitrix присылает названия чужих встреч;
  `/calendar/accessibility` их вырезает. Названия отдаёт только `/calendar/events`, и чужой
  `user_id` там доступен лишь Руководителю портфеля.

## Required verification

1. `python -m pytest tests -q`
2. `pyright` (config: `pyrightconfig.json`). CI runs it as a blocking job, so a local
   green pytest with a red pyright still lands a red build; run it locally before pushing.
3. API route-table and byte-golden comparison against the checked baseline.
4. Frontend tests and production build when any response shape or dependency changes.

Keep module imports side-effect free. For a future `main.py` split, extract state and metadata helpers before routers; call helpers through their module so test monkeypatches retain one stable patch point.

## Router split (route groups in their own modules)

`main.py` holds shared state, helpers, and lifespan; route groups live in
`*_routes.py` modules following the `build_router(api)` facade pattern codex
established for auth. Each module builds an `APIRouter`, and every handler
resolves state/helpers through the passed `api` (the `main` module) **at call
time** — so `main.*` monkeypatch points (tested helpers, config like
`BITRIX_INBOUND_TOKEN`) stay valid and response bytes are unchanged.

Route modules and what main re-binds from each `build_router` return:
- `auth_routes` — /auth/login|logout|me
- `system_routes` — /health, /metrics, /ready
- `attachments_routes` — work-package activity/comments + attachments
- `collections_routes` — `register(api, router, ...)` generic-collection CRUD
  factory (team/stakeholders/assumptions/comms/kpis/decisions/meetings/
  budget-items/status-reports/backlog); registration calls + order stay in main
- `share_notes_routes` — public share + entity notes
- `tasks_routes` — task CRUD (WBS)
- `risks_routes` — risk register + updates
- `task_ops_routes` — tasks/reorder, tasks/{tid}/bitrix24-task, gantt-data, deps
- `portfolio_routes` — portfolio/dashboard, attention, me/tasks, search,
  trends/workload/risk-heatmap/milestones/risks, me/calendar.ics, admin digests
- `bitrix_routes` — backlog->Bitrix, test-connection, inbound webhook, settings,
  sync-log
- `bitrix_calendar_routes` — календарь Bitrix (события/занятость/создание) + подбор
  общего слота для совещания
- `fireflies_routes` — вебхук Fireflies V2 `/webhooks/fireflies` (подпись, очередь
  `fireflies_sync`) + `/admin/fireflies/sync` (список, повтор); работа — в воркере
  `fireflies_sync.run_due` (джоба APScheduler раз в минуту), ядро сопоставления — `fireflies_match`
- `directory_routes` — /users, /persons CRUD + Bitrix import
- `admin_routes` — /admin/users, /me profile, /admin/settings (rag/smtp)
- `projects_routes` — project CRUD + lifecycle (archive/template/transfer/editors/clone/summary/version_log/action-log)
- `project_ops_routes` — budget, baselines, meeting finalize/distribute/recur, backlog-promote, status-report, risks-summary, tasks/bulk

Rules when adding/moving routes:
- Shared or **tested/monkeypatched** helpers (e.g. `_wp_in_project`,
  `_validate_*`, `_log_action`, `_diff_detail`, `_accessible_projects`,
  `BITRIX_INBOUND_TOKEN`) stay defined in `main.py`; the module references them
  as `api.<name>`. Never move a helper a test patches on `main`.
- After any move: import must succeed, `pytest tests -q` must be fully green, the live
  openapi route-table diff vs baseline = 0, the golden compare must match every snapshot
  (via `http://127.0.0.1:8002`, not `localhost` — IPv6 fallback), and writeflow must pass
  every check for write paths. Note `len(app.routes)` under-counts included-router routes in
  this FastAPI version — use the openapi route-table, not that count.
- All route groups are now extracted into `*_routes.py`. `main.py` is a thin
  assembly: shared helpers/state, lifespan, the `@app.middleware("http")` metrics
  middleware, `_register_collection` calls, and the `include_router` wiring. New
  routes belong in the matching `*_routes.py` module, not in `main.py`.

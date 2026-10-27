# -*- coding: utf-8 -*-
"""Сводный бюджет по дереву: ставка часа, отнесение статей к блокам зонтика, остаток.

Здесь проверяется то, ради чего замысел был переделан. Первый вариант обнулял план у
привязанной статьи — и «эти деньги считают в другом месте» становилось неотличимо от «денег
нет»: портфель подставлял вместо нуля утверждённый лимит, а подпроект на своём экране видел
«0 из лимита». Поэтому привязка теперь ОТНОСИТ, но ничего не обнуляет, а часы превращаются
в деньги ОДИН раз при записи. Тесты стерегут оба свойства.
"""
import json

import main
from fastapi.testclient import TestClient

client = TestClient(main.app)


def _tok(email="owner@company.com", password="admin123"):
    r = client.post("/auth/login", json={"email": email, "password": password}).json()
    return {"Authorization": "Bearer %s" % r["access_token"]}


def _row(pid, meta, tree=None):
    return {"id": pid, "name": "P%s" % pid, "identifier": "p%s" % pid,
            "description": {"raw": json.dumps(meta)},
            "createdAt": "2026-09-01T00:00:00Z", "updatedAt": "2026-09-01T00:00:00Z",
            "parent_id": (tree or {}).get("parent_id"),
            "_tree": {"parent_id": None, "parent_code": None, "parent_name": None,
                      "parent_budget_rate": None, "subprojects_count": 0,
                      "inherited_editors": [], "inherited_observers": [], **(tree or {})}}


# ─────────────────────────── ставка часа ───────────────────────────

def test_rate_reads_what_people_actually_type():
    """`_num` молча даёт 0 на «50,5» и «12 000» — для ставки это обнулило бы всё дерево."""
    assert main.parse_money("50,5") == 50.5
    assert main.parse_money("12 000") == 12000.0
    assert main.parse_money(" 40 ") == 40.0
    assert main.parse_money(0) == 0.0, "ноль — это «часы не тарифицируем», а не «не задано»"
    assert main.parse_money(None) is None and main.parse_money("") is None


def test_rate_refuses_garbage_instead_of_silently_zeroing():
    """Тихий ноль здесь означал бы: у крупной программы бюджет 0, а в портфеле — лимит."""
    for bad in ("50 EUR", "abc", "--3", float("nan")):
        try:
            main.parse_money(bad, "Ставка часа")
            raise AssertionError("прошло: %r" % (bad,))
        except main.HTTPException as e:
            assert e.status_code == 422 and "Ставка часа" in e.detail
    try:
        main.parse_money(-1, "Ставка часа")
        raise AssertionError("отрицательная ставка прошла")
    except main.HTTPException as e:
        assert e.status_code == 422


def test_zero_rate_is_not_the_same_as_no_rate():
    """Через `or` ноль превращался бы в ставку зонтика — и один и тот же проект считался бы
    по-разному в зависимости от того, пришёл ноль строкой из формы или числом из импорта."""
    inherited = {"_tree": {"parent_budget_rate": "50"}}
    assert main._effective_rate(inherited) == 50.0
    assert main._effective_rate({"budget_rate": 0, **inherited}) == 0.0
    assert main._effective_rate({"budget_rate": "0", **inherited}) == 0.0
    assert main._effective_rate({"budget_rate": 60, **inherited}) == 60.0
    assert main._effective_rate({}) == 0.0


def test_hours_become_money_once_and_do_not_rewrite_the_past():
    """Деньги считаются при ЗАПИСИ. Иначе любая смена ставки молча удорожала бы прошлые
    месяцы — и расхождение со статус-отчётом, где сумма заморожена, было бы нечем объяснить."""
    m = {"budget_rate": 50}
    it = {}
    main._budget_before_write(m, it, {"planned_hours": 200}, {})
    assert it["planned_hours"] == 200 and it["amount"] == 10000.0

    m["budget_rate"] = 60          # ставку подняли...
    main._budget_before_write(m, it, {"planned_hours": 200, "amount": 10000}, dict(it))
    assert it["amount"] == 10000.0, "прошлое переписано сменой ставки"


def test_editing_hours_moves_the_money_but_editing_the_name_does_not():
    """Форма статьи присылает ВСЕ поля целиком при каждом сохранении. Поэтому правило —
    «что изменилось», а не «что прислали»: иначе правка названия стирала бы часы, а правка
    часов не двигала бы сумму (на экране «900 ч» по цене 800)."""
    m = {"budget_rate": 50}
    stored = {"name": "Блок", "planned_hours": 800, "amount": 40000}

    def save(payload):
        """Как это делает фабрика: сперва поля payload ложатся в элемент, потом зовётся хук."""
        it = dict(stored)
        pre = {k: it.get(k) for k in payload}
        it.update(payload)
        main._budget_before_write(m, it, payload, pre)
        return it

    # правим только название — часы и деньги на месте
    it = save({"name": "Блок 2", "planned_hours": "800", "amount": "40000"})
    assert it["planned_hours"] == 800 and main._num(it["amount"]) == 40000

    # правим часы — деньги идут следом
    it = save({"planned_hours": "900", "amount": "40000"})
    assert it["planned_hours"] == 900 and it["amount"] == 45000.0

    # вписали сумму руками в той же правке — она главнее расчёта
    it = save({"planned_hours": "900", "amount": "1"})
    assert it["planned_hours"] == 900 and main._num(it["amount"]) == 1

    # часы сняли — деньги остаются, их никто не просил стирать
    it = save({"planned_hours": "", "amount": "40000"})
    assert it["planned_hours"] is None and main._num(it["amount"]) == 40000


def test_hours_without_a_rate_leave_money_alone():
    it = {}
    main._budget_before_write({}, it, {"planned_hours": 200}, {})
    assert it["planned_hours"] == 200 and "amount" not in it


def test_numbers_are_parsed_at_the_write_boundary_not_guessed_at_read():
    """«12 000» бэкенд читал как 0, а фронт — как NaN и проваливался в сумму месяцев: одна
    статья показывала два разных числа на одном экране. Разбираем при записи — дальше по
    системе идёт число, и расходиться нечему."""
    it = {}
    main._normalize_budget_numbers(it, {"amount": "12 000", "labour_hours": "50,5"})
    assert it["amount"] == 12000.0 and it["labour_hours"] == 50.5

    # Пустое — это «не задано», а не ноль: трогать нельзя.
    it = {"amount": 5}
    main._normalize_budget_numbers(it, {"amount": "", "forecast_total": None})
    assert it["amount"] == 5 and "forecast_total" not in it

    # Мусор — 422 с именем поля, а не тихий ноль.
    try:
        main._normalize_budget_numbers({}, {"amount": "около двенадцати"})
        raise AssertionError("мусор прошёл")
    except main.HTTPException as e:
        assert e.status_code == 422 and "amount" in e.detail


# ─────────────────────────── домен не тронут ───────────────────────────

def test_domain_math_is_untouched_by_phase_c():
    """Главное свойство переделки: `_budget_planned`/`_budget_actual` НЕ получили аргумента
    ставки, поэтому портфель, снимки, by_category, burn-down и MCP считают как раньше —
    а не «как раньше, если ставка 0». Байтовая идентичность здесь структурная."""
    import inspect
    import domain
    assert list(inspect.signature(domain._budget_planned).parameters) == ["i"]
    assert list(inspect.signature(domain._budget_actual).parameters) == ["i"]
    linked = {"amount": 500, "parent_item_id": "b1"}
    assert domain._budget_planned(linked) == 500.0, "привязка НЕ обнуляет план"


def test_burndown_no_longer_collapses_the_same_month_of_different_years():
    """Портал пишет {year, month: 1}, а ключ считался как str(month)[:7] — январь 2026 и
    январь 2027 складывались в одну точку «1», сортировка шла как «1, 10, 11, 12, 2».
    Часы лягут в те же записи, поэтому чиним до, а не после."""
    import domain
    _, months = domain._budget_aggregates([{"category": "X", "monthly": [
        {"year": 2027, "month": 1, "planned": 500},
        {"year": 2026, "month": 1, "planned": 1000},
        {"year": 2026, "month": 10, "planned": 7}]}])
    assert [x["month"] for x in months] == ["2026-01", "2026-10", "2027-01"]
    assert [x["planned"] for x in months] == [1000.0, 7.0, 500.0]
    # Легаси-форма (месяц уже строкой) не трогается.
    _, legacy = domain._budget_aggregates([{"category": "X", "monthly": [{"month": "2026-01", "planned": 5}]}])
    assert [x["month"] for x in legacy] == ["2026-01"]


# ─────────────────────────── сведение ───────────────────────────

def _umbrella():
    return {"code": "UMB", "budget_currency": "EUR", "budget_rate": 50, "_budget": [
        {"id": "b1", "name": "Блок 1", "category": "dev", "amount": 40000, "planned_hours": 800},
        {"id": "b2", "name": "Блок 2", "category": "dev", "amount": 10000},
        {"id": "inc", "name": "Доход", "kind": "income", "amount": 99999},
    ]}


def _child(code, items):
    return (code, code, "Проект " + code, {"code": code, "budget_currency": "EUR", "_budget": items})


def test_umbrella_sees_what_each_subproject_took_from_each_block():
    """Ровно тот вопрос, ради которого затевалась связка: сколько осталось по блоку подрядчика,
    а не сумма цифр из вкладок всех подпроектов."""
    kids = [
        _child("A", [{"id": "a1", "name": "Статья A", "parent_item_id": "b1",
                      "monthly": [{"year": 2026, "month": 8, "actual": 5000}]}]),
        _child("B", [{"id": "b_1", "name": "Статья B", "parent_item_id": "b1",
                      "monthly": [{"year": 2026, "month": 8, "actual": 1000}]},
                     {"id": "b_2", "name": "Своё", "amount": 300,
                      "monthly": [{"year": 2026, "month": 8, "actual": 200}]}]),
    ]
    d = main._consolidate_budget(_umbrella(), kids)
    b1 = next(b for b in d["blocks"] if b["item_id"] == "b1")
    assert b1["planned"] == 40000.0 and b1["planned_hours"] == 800.0
    assert b1["consumed_by_children"] == 6000.0 and b1["remaining"] == 34000.0
    assert sorted(c["project_code"] for c in b1["by_child"]) == ["A", "B"]
    # Доходная статья зонтика в расходную матрицу не попадает.
    assert [b["item_id"] for b in d["blocks"]] == ["b1", "b2"]
    # Непривязанные расходы ребёнка не теряются — они просто не в блоках.
    assert d["unattributed"] and d["unattributed"][0]["actual"] == 200.0
    assert d["totals"]["consumed_by_children"] == 6000.0


def test_overspend_shows_as_a_negative_remainder_not_as_a_hidden_number():
    kids = [_child("A", [{"id": "a1", "parent_item_id": "b2", "actual_total": 12000}])]
    d = main._consolidate_budget(_umbrella(), kids)
    b2 = next(b for b in d["blocks"] if b["item_id"] == "b2")
    assert b2["remaining"] == -2000.0, "перерасход — сигнал подрядчику, его нельзя прятать"


def test_money_pointing_at_a_deleted_block_becomes_a_visible_orphan():
    """Статью зонтика удалили, факт ребёнка остался. Молча выкинуть его нельзя: деньги
    настоящие, и вопрос к людям, а не повод их спрятать."""
    kids = [_child("A", [{"id": "a1", "name": "Статья A", "parent_item_id": "УДАЛЁННЫЙ",
                          "actual_total": 900}])]
    d = main._consolidate_budget(_umbrella(), kids)
    assert len(d["orphans"]) == 1 and d["orphans"][0]["actual"] == 900.0
    assert d["totals"]["orphan_actual"] == 900.0
    assert all(b["consumed_by_children"] == 0 for b in d["blocks"])


def test_different_currencies_are_named_not_summed():
    """Конвертации в портале нет. Сложить KZT с EUR молча — значит показать на экране сумму,
    завышенную в сотни раз, без единого признака ошибки. Валюту проверяет и привязка, но проект
    может сменить её ПОСЛЕ — поэтому решает и чтение тоже."""
    kids = [("A", "A", "Проект A", {"budget_currency": "KZT", "_budget": [
                {"id": "a1", "parent_item_id": "b1", "actual_total": 9_000_000}]}),
            _child("B", [{"id": "b_1", "parent_item_id": "b1", "actual_total": 1000}])]
    d = main._consolidate_budget(_umbrella(), kids)
    assert d["currencies"] == ["EUR", "KZT"], "разные валюты обязаны быть видны на экране"
    b1 = next(b for b in d["blocks"] if b["item_id"] == "b1")
    assert b1["consumed_by_children"] == 1000.0, "тенге сложили с евро"
    assert [f["project_code"] for f in d["foreign_currency"]] == ["A"]
    assert d["foreign_currency"][0]["actual"] == 9_000_000.0, "чужая валюта названа, а не спрятана"


def test_zero_rate_reaches_the_screen_as_zero():
    """`or None` превращал ноль в «не задано»: проект, где часы намеренно не тарифицируют,
    показывал бы «—», и экран прятал бы часы."""
    d = main._consolidate_budget({"budget_rate": 0, "_budget": []}, [])
    assert d["rate"] == 0.0


def test_portfolio_shows_what_children_took_without_counting_it_twice():
    """Вторым проходом и только для показа: войди `budget_consumed` в итоги — деньги ребёнка
    посчитались бы и у него, и у родителя."""
    rows = [{"id": "7", "budget_plan": 50000, "budget_actual": 0, "budget_currency": "EUR"},
            {"id": "8", "budget_plan": 0, "budget_actual": 5000, "budget_currency": "EUR"}]
    projs = [({"id": "7"}, _umbrella()),
             ({"id": "8"}, {"budget_currency": "EUR", "_tree": {"parent_id": 7}, "_budget": [
                 {"id": "c1", "parent_item_id": "b1", "actual_total": 5000},
                 {"id": "c2", "actual_total": 900}]})]
    main._apply_budget_consumption(rows, projs)
    assert rows[0]["budget_consumed"] == 5000.0, "непривязанные 900 в число блока не входят"
    assert rows[0]["budget_consumed_projects"] == 1
    assert "budget_consumed" not in rows[1], "у подпроекта этого числа быть не должно"
    assert rows[0]["budget_plan"] == 50000 and rows[1]["budget_actual"] == 5000, "суммы строк не тронуты"


def test_portfolio_does_not_mix_currencies_in_what_children_took():
    rows = [{"id": "7", "budget_currency": "EUR"}]
    projs = [({"id": "7"}, _umbrella()),
             ({"id": "8"}, {"budget_currency": "KZT", "_tree": {"parent_id": 7}, "_budget": [
                 {"id": "c1", "parent_item_id": "b1", "actual_total": 9_000_000}]})]
    main._apply_budget_consumption(rows, projs)
    assert "budget_consumed" not in rows[0], "тенге приписали к евро"


def test_umbrella_without_children_is_still_consistent():
    d = main._consolidate_budget(_umbrella(), [])
    assert d["totals"]["planned"] == 50000.0 and d["totals"]["consumed"] == 0.0
    assert d["totals"]["remaining"] == 50000.0


# ─────────────────────────── маршруты и гарды ───────────────────────────

def test_link_is_server_only_on_every_write_path():
    """`parent_item_id` — ссылка в ЧУЖОЙ проект. Приняв её обычным PUT, портал позволил бы
    отнести свои расходы к любому блоку любого зонтика без единой проверки — тот же класс
    дыры, что был у `bitrix_event_owner` в совещаниях.

    Путей записи в коллекцию ДВА: фабрика разделов и приём черновика помощника. Второй всегда
    шёл своим mut и знал только про id/project_id/created_at, поэтому список серверных полей
    обязан быть ОДИН на оба — два списка разъедутся на первом же новом поле.
    """
    import collections_routes
    import draft_apply
    import inspect
    assert main._protected_fields("_budget") == ("parent_item_id",)
    assert "bitrix_event_owner" in main._protected_fields("_meetings")
    assert main._protected_fields("_team") == ()
    assert "before_write" in inspect.signature(collections_routes.register).parameters
    # Оба писателя спрашивают ОДНУ таблицу, а не носят свою копию.
    assert "_protected_fields(key)" in inspect.getsource(draft_apply._apply_coll)
    assert "_protected_fields(key)" in inspect.getsource(main._register_collection)


def test_link_refuses_a_project_outside_a_tree(monkeypatch):
    async def meta(pid):
        el = _row(int(pid), {"code": "SOLO", "_budget": [{"id": "x"}]})
        return el, main._meta(el)
    monkeypatch.setattr(main, "load_meta", meta)
    r = client.post("/projects/5/budget-items/x/link", json={"parent_item_id": "b1"}, headers=_tok())
    assert r.status_code == 422 and "не входит" in r.json()["detail"]


def test_link_refuses_income_block_and_foreign_currency(monkeypatch):
    child = _row(5, {"code": "CH", "budget_currency": "EUR", "_budget": [{"id": "x"}]},
                 {"parent_id": 7})
    parent = _row(7, _umbrella())

    async def meta(pid):
        el = child if str(pid) == "5" else parent
        el.pop("_meta_cache", None)
        return el, main._meta(el)
    monkeypatch.setattr(main, "load_meta", meta)

    r = client.post("/projects/5/budget-items/x/link", json={"parent_item_id": "inc"}, headers=_tok())
    assert r.status_code == 422 and "расходному" in r.json()["detail"]

    r = client.post("/projects/5/budget-items/x/link", json={"parent_item_id": "НЕТ"}, headers=_tok())
    assert r.status_code == 404

    child["description"]["raw"] = json.dumps({"code": "CH", "budget_currency": "KZT",
                                              "_budget": [{"id": "x"}]})
    child.pop("_meta_cache", None)
    r = client.post("/projects/5/budget-items/x/link", json={"parent_item_id": "b1"}, headers=_tok())
    assert r.status_code == 422 and "Валюты" in r.json()["detail"]


def test_umbrella_view_goes_through_the_route(monkeypatch):
    """Ветка `view=umbrella` МАРШРУТА, а не только чистая функция под ней.

    Чистую свёртку стерегут тесты выше, но до неё ещё надо дойти: маршрут сам решает, какой
    это вид, сам собирает детей и сам приклеивает project_id. Эта половина не вызывалась в
    pytest ни разу — «оба view» из плана были покрыты наполовину.
    """
    umb = _row(7, _umbrella(), {"subprojects_count": 2})
    kid_a = _row(5, {"code": "A", "budget_currency": "EUR", "_budget": [
        {"id": "x", "parent_item_id": "b1", "actual_total": 1000}]}, {"parent_id": 7})
    kid_b = _row(6, {"code": "B", "budget_currency": "EUR", "_budget": [
        {"id": "y", "parent_item_id": "b1", "actual_total": 4000},
        {"id": "z", "name": "Своя статья", "amount": 700}]}, {"parent_id": 7})

    seen = {}

    async def meta(pid):
        el = {"5": kid_a, "6": kid_b, "7": umb}[str(pid)]
        return el, main._meta(el)

    async def readable(pid, user):
        seen["readable"] = str(pid)
        return [(kid_a, main.to_project(kid_a), main._meta(kid_a)),
                (kid_b, main.to_project(kid_b), main._meta(kid_b))]
    monkeypatch.setattr(main, "load_meta", meta)
    # У зонтика — ВИДИМЫЕ дети: их имена и суммы уходят наружу поимённо, и показывать чужой
    # подпроект тому, кто его открыть не вправе, нельзя. Остаток при этом всё равно честный:
    # его считает та же свёртка по колонке `consumed`.
    monkeypatch.setattr(main, "_readable_children", readable)

    d = client.get("/projects/7/budget-consolidated", headers=_tok()).json()["data"]
    assert d["view"] == "umbrella" and d["project_id"] == "7"
    assert seen["readable"] == "7", "дети берутся у зонтика, а не у кого-то ещё"

    b1 = next(b for b in d["blocks"] if b["item_id"] == "b1")
    assert b1["planned"] == 40000.0, "план блока живёт у зонтика"
    assert b1["consumed"] == 5000.0 and b1["remaining"] == 35000.0
    assert {str(c["project_id"]): c["actual"] for c in b1["by_child"]} == {"5": 1000.0, "6": 4000.0}
    # Пустой блок остаётся в матрице: «никто не тратил» — это тоже ответ.
    b2 = next(b for b in d["blocks"] if b["item_id"] == "b2")
    assert b2["consumed"] == 0.0 and b2["remaining"] == 10000.0
    # Доходная статья зонтика в расходную матрицу не попадает.
    assert all(b["item_id"] != "inc" for b in d["blocks"])


def test_consolidated_says_none_for_a_project_outside_a_tree(monkeypatch):
    async def meta(pid):
        el = _row(5, {"code": "SOLO"})
        return el, main._meta(el)
    monkeypatch.setattr(main, "load_meta", meta)
    d = client.get("/projects/5/budget-consolidated", headers=_tok()).json()["data"]
    assert d == {"view": "none"}


def test_subproject_view_names_no_siblings(monkeypatch):
    """Подпроекту нужен ОСТАТОК по блоку, а не список соседей с суммами: экран выбора статьи
    не должен становиться ведомостью чужих трат."""
    child = _row(5, {"code": "CH", "budget_currency": "EUR", "_budget": [
        {"id": "x", "parent_item_id": "b1", "actual_total": 1000}]}, {"parent_id": 7})
    sibling = _row(6, {"code": "SIB", "budget_currency": "EUR", "_budget": [
        {"id": "y", "parent_item_id": "b1", "actual_total": 4000}]}, {"parent_id": 7})
    parent = _row(7, _umbrella(), {"subprojects_count": 2})

    async def meta(pid):
        el = {"5": child, "6": sibling, "7": parent}[str(pid)]
        return el, main._meta(el)

    async def kids(pid):
        return [(child, main.to_project(child), main._meta(child)),
                (sibling, main.to_project(sibling), main._meta(sibling))]

    async def may_read(user, pid):
        return True
    monkeypatch.setattr(main, "load_meta", meta)
    # Именно `_child_rows` (ВСЕ дети), а не `_readable_children`: остаток по блоку обязан
    # считаться по всем подпроектам, иначе он завышен ровно на долю невидимых соседей.
    monkeypatch.setattr(main, "_child_rows", kids)
    monkeypatch.setattr(main, "_user_can_read_project", may_read)

    d = client.get("/projects/5/budget-consolidated", headers=_tok()).json()["data"]
    assert d["view"] == "subproject" and d["parent_project_id"] == "7"
    b1 = next(b for b in d["blocks"] if b["item_id"] == "b1")
    assert b1["planned"] == 40000.0 and b1["consumed"] == 5000.0 and b1["remaining"] == 35000.0
    assert b1["my_actual"] == 1000.0
    assert "by_child" not in b1 and "SIB" not in json.dumps(d, ensure_ascii=False)


def test_umbrella_money_needs_rights_on_the_umbrella(monkeypatch):
    """Наследование прав идёт ВНИЗ: чтение зонтика получают РП и со-РП подпроектов, но не их
    наблюдатели. Без явной проверки представитель подрядчика, добавленный наблюдателем в один
    модуль, читал бы плановый бюджет всей программы — `rbac` проверил только его модуль."""
    child = _row(5, {"code": "CH", "_budget": []}, {"parent_id": 7})

    async def meta(pid):
        return (child, main._meta(child)) if str(pid) == "5" else (_row(7, _umbrella()), None)

    async def no_read(user, pid):
        return False
    monkeypatch.setattr(main, "load_meta", meta)
    monkeypatch.setattr(main, "_user_can_read_project", no_read)
    d = client.get("/projects/5/budget-consolidated", headers=_tok()).json()["data"]
    assert d == {"view": "none"}, "бюджет зонтика ушёл тому, кто зонтик открыть не вправе"


def test_remainder_counts_every_subproject_not_only_the_visible_ones(monkeypatch):
    """Остаток по блоку = план − то, что откусили ВСЕ. Посчитанный по видимым соседям он
    завышен, а именно по нему планируют следующий заказ подрядчику."""
    import inspect
    import project_ops_routes
    src = inspect.getsource(project_ops_routes)
    assert "api._child_rows(str(parent_id))" in src
    assert "_readable_children(str(parent_id)" not in src


def test_budget_summary_keeps_its_key_order_and_appends_phase_c_at_the_end(monkeypatch):
    async def meta(pid):
        el = _row(5, {"code": "C", "budget_currency": "EUR", "_budget": []})
        return el, main._meta(el)
    monkeypatch.setattr(main, "load_meta", meta)
    body = client.get("/projects/5/budget-summary", headers=_tok()).json()["data"]
    assert list(body.keys())[-4:] == ["rate", "rate_inherited", "parent_project_id", "subprojects_count"]
    assert body["rate"] is None and body["subprojects_count"] == 0


def test_clone_does_not_carry_a_link_into_a_foreign_umbrella():
    import inspect
    import projects_routes
    src = inspect.getsource(projects_routes)
    assert 'ni.pop("parent_item_id", None)' in src


def test_one_loader_feeds_both_the_subprojects_table_and_the_budget():
    """Два экрана обязаны согласоваться в трёх вещах разом: кто ребёнок, кого отсечь по правам
    и в каком порядке выдать. Ровно на таких парах здесь уже расходились фильтры доступа."""
    import inspect
    import project_ops_routes
    import projects_routes
    for mod in (project_ops_routes, projects_routes):
        src = inspect.getsource(mod)
        assert "api._readable_children" in src
        assert "db.child_project_ids" not in src, "второй загрузчик детей — начало расхождения"

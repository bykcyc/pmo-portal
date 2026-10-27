/**
 * Карточка элемента бэклога.
 *
 * Это первый в портале тест на РАМУ карточки, и написан он не ради покрытия. У карточки задачи
 * рамы под тестом нет, e2e и визуальные снимки модалок не открывают вовсе — зелёный прогон не
 * отличал бы работающую карточку от нерисующейся. Поэтому здесь проверяются ровно те вещи,
 * которые тихо ломаются и которых больше нигде не видно: доступность окна, закрытие, каскад
 * дат (общий с таблицей), одна запись вместо двух при выборе человека, отправка только
 * тронутого и режим «только просмотр».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BacklogDrawer from './BacklogDrawer'
import type { BacklogItem } from '@/types/meeting'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

// Список внутри фабрики: vi.mock поднимается в начало файла, и внешняя константа тут ещё не создана.
vi.mock('@/api/persons', () => ({
  getPersons: vi.fn().mockResolvedValue([{ id: 'p7', full_name: 'Jānis Liepbergs', email: 'janis@example.com' }]),
  createPerson: vi.fn(),
}))

let canWrite = true
vi.mock('@/contexts/ProjectPermission', () => ({ useCanWrite: () => canWrite }))

const ITEM = {
  id: 'b1',
  project_id: '47',
  code: 'B-03',
  title: 'Перевести отчёт на новый шаблон',
  description: 'Первая строка.\n\n- раз\n- два',
  priority: 'high',
  status: 'new',
  estimated_days: 5,
  planned_start: '2026-09-01',
  planned_end: '2026-09-05',
  requested_by: 'Anna Liepa',
  assignee_name: null,
  assignee_person_id: null,
  bitrix24_task_id: null,
  created_at: '2026-09-01T10:00:00',
} as unknown as BacklogItem

const renderCard = (onSave = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <BacklogDrawer item={ITEM} onClose={onClose} onSave={onSave} />
    </QueryClientProvider>,
  )
  return { ...utils, onSave, onClose }
}

beforeEach(() => { canWrite = true })

describe('BacklogDrawer — рама', () => {
  it('это модальное окно с именем: role, aria-modal и заголовок по ссылке', () => {
    renderCard()
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    const titleId = dlg.getAttribute('aria-labelledby')
    expect(titleId).toBeTruthy()
    expect(document.getElementById(titleId as string)?.textContent).toContain('Перевести отчёт')
  })

  it('Escape закрывает', () => {
    const { onClose } = renderCard()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('нажатие на подложку закрывает, нажатие внутри — нет', () => {
    const { onClose } = renderCard()
    const dlg = screen.getByRole('dialog')
    fireEvent.click(screen.getByLabelText('common.close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    // Внутри панели нажатие всплывать не должно: иначе окно закрывалось бы от любого щелчка.
    fireEvent.mouseDown(screen.getByDisplayValue('Перевести отчёт на новый шаблон'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(dlg)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('выделяли текст внутри, отпустили мышь на подложке — карточка остаётся', () => {
    // Браузер отдаёт click ОБЩЕМУ предку начала и конца жеста, то есть подложке: с onClick
    // карточка закрывалась ровно тогда, когда человек выделял мышью длинное описание.
    const { onClose } = renderCard()
    const dlg = screen.getByRole('dialog')
    fireEvent.mouseDown(screen.getByDisplayValue('Перевести отчёт на новый шаблон'))
    fireEvent.click(dlg)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('поля находятся по подписи — значит подписи связаны с полями', () => {
    renderCard()
    expect(screen.getByLabelText('decisions.titleField')).toBeTruthy()
    expect(screen.getByLabelText('backlog.priority')).toBeTruthy()
    expect(screen.getByLabelText('common.status')).toBeTruthy()
    expect(screen.getByLabelText('backlog.estimatedDays')).toBeTruthy()
    // Два поля человека на одной форме обязаны различаться по имени.
    expect(screen.getByLabelText('Ответственный')).toBeTruthy()
    expect(screen.getByLabelText('backlog.requestedBy')).toBeTruthy()
  })

  it('описание живёт на своей вкладке и открывается оформленным', () => {
    const { container } = renderCard()
    expect(screen.queryByLabelText('common.description')).toBeNull()
    fireEvent.click(screen.getByText('Описание'))
    // Размеченный текст показываем сразу оформленным: раньше человек видел «- раз» буквально,
    // потому что разметка рисовалась только по кнопке «Просмотр», и её никто не нажимал.
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelector('textarea')).toBeNull()
    fireEvent.click(screen.getByText('Правка'))
    const area = screen.getByLabelText('common.description') as HTMLTextAreaElement
    expect(area.value).toContain('- раз')
    // Переносы строк доходят до поля целиком — ради этого карточку и делали.
    expect(area.value.split(String.fromCharCode(10)).length).toBe(4)
  })
})

describe('BacklogDrawer — запись', () => {
  it('наружу уходит только тронутое, а не весь пункт', async () => {
    const { onSave } = renderCard()
    fireEvent.change(screen.getByLabelText('decisions.titleField'), { target: { value: 'Новое имя' } })
    fireEvent.click(screen.getByText('taskDrawer.saveChanges'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [id, patch] = onSave.mock.calls[0]
    expect(id).toBe('b1')
    expect(patch).toEqual({ title: 'Новое имя' })
  })

  it('каскад дат тот же, что в таблице: правка дней двигает окончание', async () => {
    const { onSave } = renderCard()
    const days = screen.getByLabelText('backlog.estimatedDays')
    fireEvent.change(days, { target: { value: '3' } })
    fireEvent.blur(days)
    fireEvent.click(screen.getByText('taskDrawer.saveChanges'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const patch = onSave.mock.calls[0][1]
    expect(patch.estimated_days).toBe(3)
    expect(patch.planned_end).toBe('2026-09-03')
    // Начало человек не трогал — его в правке быть не должно, иначе карточка откатит
    // чужой сдвиг, сделанный пока она была открыта.
    expect('planned_start' in patch).toBe(false)
  })

  it('передумал и стёр «дни» — окончание остаётся прежним', async () => {
    // Это главная граница: каскад на КАЖДОЕ нажатие уже успевал переписать окончание, а
    // пустое значение ничего не пересчитывает — вернуть его было нечем. В таблице тот же
    // ввод (набрал, стёр, ушёл из ячейки) окончание не трогает.
    const { onSave } = renderCard()
    const days = screen.getByLabelText('backlog.estimatedDays')
    fireEvent.change(days, { target: { value: '7' } })
    fireEvent.change(days, { target: { value: '' } })
    fireEvent.blur(days)
    fireEvent.change(screen.getByLabelText('decisions.titleField'), { target: { value: 'Другое имя' } })
    fireEvent.click(screen.getByText('taskDrawer.saveChanges'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const patch = onSave.mock.calls[0][1]
    expect(patch.planned_end).toBeUndefined()
    expect(patch.estimated_days).toBeNull()
  })

  it('закрытие сохраняет набранное, а не выбрасывает его', async () => {
    // Поля уходили на сервер только по кнопке, а закрыть карточку можно тремя способами.
    // Описание правят минутами — и три способа из трёх молча его теряли.
    const { onSave, onClose } = renderCard()
    fireEvent.change(screen.getByLabelText('decisions.titleField'), { target: { value: 'Имя из закрытия' } })
    fireEvent.mouseDown(screen.getByRole('dialog'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toEqual({ title: 'Имя из закрытия' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('закрытие уносит и незаконченный ввод «дней» — из поля выйти не успели', async () => {
    const { onSave } = renderCard()
    fireEvent.change(screen.getByLabelText('backlog.estimatedDays'), { target: { value: '3' } })
    // Никакого blur: человек набрал число и сразу нажал на подложку.
    fireEvent.mouseDown(screen.getByRole('dialog'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const patch = onSave.mock.calls[0][1]
    expect(patch.estimated_days).toBe(3)
    expect(patch.planned_end).toBe('2026-09-03')
  })

  it('правка даты и сразу закрытие: уезжает НОВОЕ окончание, а не старое', async () => {
    // Поле «дней» — теневая копия estimated_days, и копия обязана следовать за каскадом.
    // Пока она не следовала, закрытие пересчитывало даты ОТ НЕЁ и откатывало только что
    // выставленное окончание — карточка затирала собственную правку.
    const { onSave } = renderCard()
    fireEvent.change(screen.getByLabelText('Окончание'), { target: { value: '12.09.2026' } })
    fireEvent.mouseDown(screen.getByRole('dialog'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const patch = onSave.mock.calls[0][1]
    expect(patch.planned_end).toBe('2026-09-12')
    expect(patch.estimated_days).toBe(12)
    // «Начало» человек не трогал — в патче его быть не должно.
    expect('planned_start' in patch).toBe(false)
  })

  it('незавершённый ввод «дней» уносит только изменившееся, нетронутое начало остаётся дома', async () => {
    // recalcDates возвращает ВСЮ тройку, и «начало» уезжало наверх в том виде, в каком было
    // при открытии карточки, — затирая сдвиг, сделанный за это время в таблице.
    const { onSave } = renderCard()
    fireEvent.change(screen.getByLabelText('backlog.estimatedDays'), { target: { value: '3' } })
    fireEvent.mouseDown(screen.getByRole('dialog'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toEqual({ estimated_days: 3, planned_end: '2026-09-03' })
  })

  it('сервер не принял — карточка остаётся открытой, но второе нажатие всё же выпускает', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('500'))
    const { onClose } = renderCard(onSave)
    fireEvent.change(screen.getByLabelText('decisions.titleField'), { target: { value: 'Не доедет' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Не доедет')).toBeTruthy()
    expect(screen.getByText('taskDrawer.saveFailedClose')).toBeTruthy()
    // Без второго выхода пропавшая связь запирала бы карточку насовсем.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('выбор человека из справочника даёт ОДНУ запись и сохраняет идентичность', async () => {
    const { onSave } = renderCard()
    const picker = screen.getByLabelText('Ответственный')
    fireEvent.focus(picker)
    fireEvent.change(picker, { target: { value: 'Jānis' } })
    const option = await screen.findByText('Jānis Liepbergs')
    // Выбор в списке — по click (mousedown там только гасит уход фокуса, см. PersonPicker:371-373).
    fireEvent.click(option)
    fireEvent.click(screen.getByText('taskDrawer.saveChanges'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledTimes(1)
    const patch = onSave.mock.calls[0][1]
    expect(patch.assignee_name).toBe('Jānis Liepbergs')
    // Именно это поле обнулялось вторым запросом в ячейке таблицы — и эскалация в план
    // работ теряла исполнителя, потому что резолвит она только по person_id.
    expect(patch.assignee_person_id).toBe('p7')
  })

  it('пустое название гасит сохранение', () => {
    renderCard()
    fireEvent.change(screen.getByLabelText('decisions.titleField'), { target: { value: '   ' } })
    expect((screen.getByText('taskDrawer.saveChanges').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Название не может быть пустым')).toBeTruthy()
  })
})

describe('BacklogDrawer — только просмотр', () => {
  it('читателю карточка открывается, но не пишет: кнопки нет, контролы отключены', () => {
    canWrite = false
    const { container } = renderCard()
    expect(screen.queryByText('taskDrawer.saveChanges')).toBeNull()
    // Мерить нужно селектором :disabled, а не свойством элемента: «нарисовано текстом»
    // и «действительно отключено» на глаз неразличимы, и мы уже принимали одно за другое.
    const measure = () => {
      const controls = container.querySelectorAll('[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea')
      expect(controls.length).toBeGreaterThan(0)
      for (const el of Array.from(controls)) {
        expect(el.matches(':disabled'), `живой контрол в режиме просмотра: ${el.outerHTML.slice(0, 80)}`).toBe(true)
      }
    }
    measure()
    // На вкладке описания контролов нет вовсе: читателю текст показывают оформленным, а не
    // отключённым полем ввода — отключённое поле он всё равно не отличит от обычного.
    fireEvent.click(screen.getByText('Описание'))
    expect(container.querySelector('[role="dialog"] textarea')).toBeNull()
    expect(container.textContent).toContain('раз')
    expect(container.textContent).not.toContain('**')
  })
})

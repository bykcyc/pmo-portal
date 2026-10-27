import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import { getProjects } from '@/api/projects'
import type { ProjectListItem } from '@/types/project'
import { useAuthStore } from '@/store/authStore'
import {
  getFavoriteProjectIds,
  getRecentProjectIds,
  toggleFavoriteProject,
} from '@/utils/recentProjects'

interface Props {
  currentProjectId: string | undefined
}

const MAX_SHOWN = 7

// UX-04: вместо плоского списка всех проектов сайдбар показывает компактный набор —
// избранные (звёздочка) + недавно открытые + текущий. Полный список — на странице «Проекты».
// Ссылки «Все проекты» внизу секции нет намеренно: она вела ровно туда же, куда пункт меню
// «Проекты» строкой выше, и была лишней (замечание владельца).
export default function ProjectNavSection({ currentProjectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const uid = useAuthStore((s) => s.user?.id) ?? ''

  const { data } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => getProjects({ per_page: 100 }),
    staleTime: 60_000,
    // компонент рендерит null вне /projects — не гоняем запрос 100 проектов на каждом protected-роуте
    enabled: location.pathname.startsWith('/projects'),
  })

  const [favIds, setFavIds] = useState<string[]>(() => getFavoriteProjectIds(uid))
  useEffect(() => {
    setFavIds(getFavoriteProjectIds(uid))
  }, [uid])

  if (!location.pathname.startsWith('/projects')) return null

  const all = data?.data ?? []
  const byId = new Map<string, ProjectListItem>(all.map((p) => [p.id, p]))
  const recentIds = getRecentProjectIds(uid)

  // Порядок: избранные → недавние (без дублей) → текущий (если ещё не в списке).
  const orderedIds: string[] = []
  const push = (id: string | undefined) => {
    if (id && byId.has(id) && !orderedIds.includes(id)) orderedIds.push(id)
  }
  favIds.forEach(push)
  recentIds.forEach(push)
  push(currentProjectId)
  const shown = orderedIds.slice(0, MAX_SHOWN).map((id) => byId.get(id)!)

  const toggleFav = (e: MouseEvent, id: string) => {
    e.stopPropagation()
    e.preventDefault()
    setFavIds(toggleFavoriteProject(uid, id))
  }

  return (
    <div className="mt-0.5 space-y-0.5">
      {shown.length === 0 ? (
        <p className="px-3 py-1.5 text-[11px] text-slate-300">{t('sidebar.noRecentProjects', { defaultValue: 'Нет недавних — откройте проект из списка' })}</p>
      ) : (
        shown.map((project) => {
          const isActive = currentProjectId === project.id
          const isFav = favIds.includes(project.id)
          return (
            <div
              key={project.id}
              className={`group flex items-center rounded-xl transition-all ${
                isActive ? 'bg-white/12 shadow-[0_8px_24px_-18px_rgba(255,255,255,0.65)]' : 'hover:bg-white/8'
              }`}
            >
              <button
                onClick={() => {
                  navigate(`/projects/${project.id}/passport`)
                }}
                title={`${project.code} - ${project.name}`}
                className={`flex min-w-0 flex-1 items-center gap-2 py-2 pl-4 pr-1 text-left text-xs font-medium ${
                  isActive ? 'text-white' : 'text-slate-200 group-hover:text-white'
                }`}
              >
                <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-slate-300">{project.code}</span>
                <span className="truncate">{project.name}</span>
              </button>
              <button
                onClick={(e) => toggleFav(e, project.id)}
                title={isFav ? t('sidebar.unfavorite', { defaultValue: 'Убрать из избранного' }) : t('sidebar.favorite', { defaultValue: 'В избранное' })}
                aria-label={isFav ? t('sidebar.unfavorite', { defaultValue: 'Убрать из избранного' }) : t('sidebar.favorite', { defaultValue: 'В избранное' })}
                aria-pressed={isFav}
                className={`mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isFav ? 'text-amber-400' : 'text-slate-500 opacity-0 hover:text-amber-300 focus-visible:opacity-100 group-hover:opacity-100'
                }`}
              >
                <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

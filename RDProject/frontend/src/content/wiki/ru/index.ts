import type { WikiPage } from '../types'
import { startPage } from './start'
import { rolesPage } from './roles'
import { passportPage } from './passport'
import { teamPage, stakeholdersPage } from './team'
import { wbsGanttPage } from './wbs-gantt'
import { kanbanPage, baselinePage, kpisPage, assumptionsPage, commPlanPage } from './planning-extras'
import { risksPage, decisionsPage } from './risks'
import { budgetPage, reportsPage } from './budget-reports'
import { meetingsPage, backlogPage } from './meetings'
import { myWorkPage } from './my-work'
import { projectsPage, portfolioPage, profilePage, settingsPage, bitrixPage } from './portal'
import { portfolioMetricsPage } from './portfolio-metrics'
import { assistantPage } from './assistant'

/** Порядок здесь = порядок в оглавлении. Внутри «Разделов проекта» он повторяет порядок
 *  вкладок в самом проекте — так человек находит статью там же, где ожидает вкладку. */
export const WIKI_PAGES: WikiPage[] = [
  // Начало работы
  startPage,
  rolesPage,
  // Разделы проекта
  passportPage,
  teamPage,
  wbsGanttPage,
  kanbanPage,
  baselinePage,
  assumptionsPage,
  commPlanPage,
  kpisPage,
  stakeholdersPage,
  risksPage,
  budgetPage,
  meetingsPage,
  reportsPage,
  decisionsPage,
  backlogPage,
  // Портал
  projectsPage,
  portfolioPage,
  portfolioMetricsPage,
  myWorkPage,
  bitrixPage,
  assistantPage,
  profilePage,
  settingsPage,
]

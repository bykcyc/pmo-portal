import type { TFunction } from 'i18next'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  BarChart2,
  Calendar,
  CheckSquare,
  DollarSign,
  FileText,
  GitBranch,
  HelpCircle,
  KanbanSquare,
  Lightbulb,
  List,
  MessageSquare,
  Network,
  TrendingUp,
  UserCheck,
  Users,
  Video,
} from 'lucide-react'

export type ProjectSectionId =
  | 'passport'
  | 'team'
  | 'stakeholders'
  | 'assumptions'
  | 'comm-plan'
  | 'kpis'
  | 'wbs'
  | 'gantt'
  | 'kanban'
  | 'baseline'
  | 'risks'
  | 'decisions'
  | 'budget'
  | 'subprojects'
  | 'backlog'
  | 'meetings'
  | 'reports'

// 'reports' — категория (Бюджет/Совещания/Статус-отчёты), не путать с секцией id:'reports'.
export type ProjectSectionCategory = 'foundation' | 'planning' | 'control' | 'reports'

export interface ProjectSectionMeta {
  id: ProjectSectionId
  displayName: string
  noviceLabel: string
  description: string
  category: ProjectSectionCategory
  requiredForLaunch: boolean
  helpText: string
  icon: LucideIcon
}

export function getProjectSections(t: TFunction): ProjectSectionMeta[] {
  return [
    {
      id: 'passport',
      icon: FileText,
      category: 'foundation',
      requiredForLaunch: true,
      displayName: t('project.sectionMeta.passport.displayName', { defaultValue: 'Project passport' }),
      noviceLabel: t('project.sectionMeta.passport.noviceLabel', { defaultValue: 'Start here' }),
      description: t('project.sectionMeta.passport.description', { defaultValue: 'Fix the purpose, owner, dates, and expected outcome of the project.' }),
      helpText: t('project.sectionMeta.passport.helpText', { defaultValue: 'If someone asks what this project is and why it exists, this section should answer it.' }),
    },
    {
      id: 'team',
      icon: Users,
      category: 'foundation',
      requiredForLaunch: true,
      displayName: t('project.sectionMeta.team.displayName', { defaultValue: 'Team and roles' }),
      noviceLabel: t('project.sectionMeta.team.noviceLabel', { defaultValue: 'Who is involved' }),
      description: t('project.sectionMeta.team.description', { defaultValue: 'List who works on the project and what each person is responsible for.' }),
      helpText: t('project.sectionMeta.team.helpText', { defaultValue: 'Use project roles, not only job titles, so responsibility is clear during delivery.' }),
    },
    {
      id: 'wbs',
      icon: List,
      category: 'planning',
      requiredForLaunch: true,
      displayName: t('project.sectionMeta.wbs.displayName', { defaultValue: 'Work breakdown (WBS)' }),
      noviceLabel: t('project.sectionMeta.wbs.noviceLabel', { defaultValue: 'What work has to be done' }),
      description: t('project.sectionMeta.wbs.description', { defaultValue: 'Break the project into phases, tasks, owners, and dates.' }),
      helpText: t('project.sectionMeta.wbs.helpText', { defaultValue: 'If work is not in the WBS, it is easy to forget, under-resource, or miss in reporting.' }),
    },
    {
      id: 'gantt',
      icon: Calendar,
      category: 'planning',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.gantt.displayName', { defaultValue: 'Timeline (Gantt)' }),
      noviceLabel: t('project.sectionMeta.gantt.noviceLabel', { defaultValue: 'When work happens' }),
      description: t('project.sectionMeta.gantt.description', { defaultValue: 'Visualize schedule, dependencies, and overlaps across project tasks.' }),
      helpText: t('project.sectionMeta.gantt.helpText', { defaultValue: 'Use the timeline to spot conflicts, bottlenecks, and unrealistic date assumptions.' }),
    },
    {
      id: 'kanban',
      icon: KanbanSquare,
      category: 'planning',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.kanban.displayName', { defaultValue: 'Board' }),
      noviceLabel: t('project.sectionMeta.kanban.noviceLabel', { defaultValue: 'Track work by status' }),
      description: t('project.sectionMeta.kanban.description', { defaultValue: 'See tasks grouped by status and move them across columns as work progresses.' }),
      helpText: t('project.sectionMeta.kanban.helpText', { defaultValue: 'Drag a card to a new column to update its status without opening the work breakdown.' }),
    },
    {
      id: 'baseline',
      icon: GitBranch,
      category: 'planning',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.baseline.displayName', { defaultValue: 'Baseline plan' }),
      noviceLabel: t('project.sectionMeta.baseline.noviceLabel', { defaultValue: 'The agreed reference plan' }),
      description: t('project.sectionMeta.baseline.description', { defaultValue: 'Freeze an approved version of the plan so later deviations can be measured.' }),
      helpText: t('project.sectionMeta.baseline.helpText', { defaultValue: 'A baseline is what you compare current reality against when someone asks what changed.' }),
    },
    {
      id: 'assumptions',
      icon: HelpCircle,
      category: 'foundation',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.assumptions.displayName', { defaultValue: 'Assumptions and constraints' }),
      noviceLabel: t('project.sectionMeta.assumptions.noviceLabel', { defaultValue: 'What we are relying on' }),
      description: t('project.sectionMeta.assumptions.description', { defaultValue: 'Capture conditions that must remain true, plus important limits around time, scope, or resources.' }),
      helpText: t('project.sectionMeta.assumptions.helpText', { defaultValue: 'Anything that can invalidate the plan later should be written here early.' }),
    },
    {
      id: 'comm-plan',
      icon: MessageSquare,
      category: 'foundation',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.commPlan.displayName', { defaultValue: 'Communication plan' }),
      noviceLabel: t('project.sectionMeta.commPlan.noviceLabel', { defaultValue: 'How updates will flow' }),
      description: t('project.sectionMeta.commPlan.description', { defaultValue: 'Define what updates are sent, to whom, how often, and by which channel.' }),
      helpText: t('project.sectionMeta.commPlan.helpText', { defaultValue: 'Use this to set expectations for weekly check-ins, steering updates, and stakeholder messaging.' }),
    },
    {
      id: 'kpis',
      icon: TrendingUp,
      category: 'control',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.kpis.displayName', { defaultValue: 'Success metrics (KPIs)' }),
      noviceLabel: t('project.sectionMeta.kpis.noviceLabel', { defaultValue: 'How success is measured' }),
      description: t('project.sectionMeta.kpis.description', { defaultValue: 'Track the metrics that show whether the project is delivering the intended result.' }),
      helpText: t('project.sectionMeta.kpis.helpText', { defaultValue: 'A KPI should help you answer whether the project is improving something measurable.' }),
    },
    {
      id: 'stakeholders',
      icon: UserCheck,
      category: 'control',
      requiredForLaunch: true,
      displayName: t('project.sectionMeta.stakeholders.displayName', { defaultValue: 'Stakeholders and influence' }),
      noviceLabel: t('project.sectionMeta.stakeholders.noviceLabel', { defaultValue: 'Who needs to be aligned' }),
      description: t('project.sectionMeta.stakeholders.description', { defaultValue: 'Track who can influence the project and how actively they need communication.' }),
      helpText: t('project.sectionMeta.stakeholders.helpText', { defaultValue: 'This section helps avoid surprises from sponsors, clients, and teams affected by the project.' }),
    },
    {
      id: 'risks',
      icon: AlertTriangle,
      category: 'control',
      requiredForLaunch: true,
      displayName: t('project.sectionMeta.risks.displayName', { defaultValue: 'Risk register' }),
      noviceLabel: t('project.sectionMeta.risks.noviceLabel', { defaultValue: 'What can go wrong' }),
      description: t('project.sectionMeta.risks.description', { defaultValue: 'Track threats to delivery, their impact, and how the team will respond.' }),
      helpText: t('project.sectionMeta.risks.helpText', { defaultValue: 'A project with no logged risks usually means the team has not looked hard enough yet.' }),
    },
    {
      id: 'budget',
      icon: DollarSign,
      category: 'reports',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.budget.displayName', { defaultValue: 'Budget' }),
      noviceLabel: t('project.sectionMeta.budget.noviceLabel', { defaultValue: 'What the project costs' }),
      description: t('project.sectionMeta.budget.description', { defaultValue: 'Plan and track expected spend across the project.' }),
      helpText: t('project.sectionMeta.budget.helpText', { defaultValue: 'Budget control is easier when cost lines are visible before spending starts.' }),
    },
    {
      id: 'meetings',
      icon: Video,
      category: 'reports',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.meetings.displayName', { defaultValue: 'Meetings and minutes' }),
      noviceLabel: t('project.sectionMeta.meetings.noviceLabel', { defaultValue: 'What was discussed' }),
      description: t('project.sectionMeta.meetings.description', { defaultValue: 'Prepare recurring meetings, capture minutes, and turn discussions into actions.' }),
      helpText: t('project.sectionMeta.meetings.helpText', { defaultValue: 'Meeting notes should tell an absent stakeholder what changed and what needs follow-up.' }),
    },
    {
      id: 'reports',
      icon: BarChart2,
      category: 'reports',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.reports.displayName', { defaultValue: 'Status reports' }),
      noviceLabel: t('project.sectionMeta.reports.noviceLabel', { defaultValue: 'How leadership sees project health' }),
      description: t('project.sectionMeta.reports.description', { defaultValue: 'Publish periodic project status, RAG signal, milestones, and next steps.' }),
      helpText: t('project.sectionMeta.reports.helpText', { defaultValue: 'This is the management view that turns detailed project data into a concise health update.' }),
    },
    {
      id: 'decisions',
      icon: Lightbulb,
      category: 'control',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.decisions.displayName', { defaultValue: 'Decisions log' }),
      noviceLabel: t('project.sectionMeta.decisions.noviceLabel', { defaultValue: 'What was decided and why' }),
      description: t('project.sectionMeta.decisions.description', { defaultValue: 'Record important choices, rationale, and implications for the team.' }),
      helpText: t('project.sectionMeta.decisions.helpText', { defaultValue: 'Decision logs reduce repeated debates and help newcomers understand past tradeoffs.' }),
    },
    {
      id: 'subprojects',
      icon: Network,
      category: 'control',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.subprojects.displayName', { defaultValue: 'Subprojects' }),
      noviceLabel: t('project.sectionMeta.subprojects.noviceLabel', { defaultValue: 'Modules of this project' }),
      description: t('project.sectionMeta.subprojects.description', { defaultValue: 'Progress, overdue work, risks and budget of every subproject in one table.' }),
      helpText: t('project.sectionMeta.subprojects.helpText', { defaultValue: 'Use it when a large programme is split into modules led by different managers.' }),
    },
    {
      id: 'backlog',
      icon: CheckSquare,
      category: 'control',
      requiredForLaunch: false,
      displayName: t('project.sectionMeta.backlog.displayName', { defaultValue: 'Action backlog' }),
      noviceLabel: t('project.sectionMeta.backlog.noviceLabel', { defaultValue: 'Follow-up actions' }),
      description: t('project.sectionMeta.backlog.description', { defaultValue: 'Keep a queue of unresolved actions, requests, and ideas that still need ownership.' }),
      helpText: t('project.sectionMeta.backlog.helpText', { defaultValue: 'Use the backlog when an item matters but should not yet become part of the committed work plan.' }),
    },
  ]
}

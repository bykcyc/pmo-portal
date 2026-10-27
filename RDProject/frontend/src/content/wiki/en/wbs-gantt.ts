import type { WikiPage } from '../types'

export const wbsGanttPage: WikiPage = {
  slug: 'wbs-gantt',
  title: 'Work plan and Gantt',
  summary: 'A list of tasks with dates and assignees — the chart draws itself from it.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/wbs`,
  sections: [
    {
      id: 'idea',
      title: 'The main idea',
      blocks: [
        { kind: 'p', text: 'There is no need to fill in the Gantt and the board separately. There is a single list of work — the Work Breakdown Structure (WBS). A task with dates appears on the Gantt, a task with a status appears on the board.' },
        { kind: 'p', text: 'Work comes in two kinds: a phase is a large block (for example, “Preparation”), and a task is what people actually do. Tasks sit inside phases.' },
      ],
    },
    {
      id: 'howto',
      title: 'How to fill it in',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Split the project into phases', text: 'Three to five large blocks. No more than that, or the plan becomes unreadable.' },
            { title: 'List the tasks inside each phase', text: 'Word it as a finished action with a result, not as a topic.' },
            { title: 'Set the dates and the assignees', text: 'A task with no assignee belongs to nobody, a task with no date runs forever. The portal flags both.' },
            { title: 'Link the tasks', text: 'The “Depends on” column: use it when a task cannot start before another one. Move the predecessor and its followers move with it.' },
          ],
        },
        { kind: 'note', tone: 'tip', text: "Pick the assignee from the People Directory instead of typing a name: the task then lands in that person's “My tasks” and, if needed, goes off to Bitrix24." },
      ],
    },
    {
      id: 'look',
      title: 'What it looks like',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/wbs.png', alt: 'Work breakdown table with phases and tasks' },
        { kind: 'shot', src: '/wiki-shots/gantt.png', alt: 'Gantt chart built from the same tasks',
          caption: 'The same plan on the Gantt — there is nothing extra to fill in.' },
      ],
    },
    {
      id: 'columns',
      title: 'Table columns',
      blocks: [
        { kind: 'p', text: 'There are many columns and you rarely need them all at once. The column settings button above the table on the right hides the extra ones, and you can drag the edge of a header to change the width.' },
        {
          kind: 'table',
          head: ['Column', 'What it means'],
          rows: [
            ['WBS', 'The number of the item in the structure; the portal works it out itself.'],
            ['Start / End', 'Planned dates. The Gantt is built from them.'],
            ['Act. start / end', 'When the work actually started and finished.'],
            ['Progress', 'Percent complete — the progress of the whole project is counted from it.'],
            ['Status', 'Not started, in progress, completed, on hold, cancelled.'],
            ['Depends on', 'The predecessor task.'],
            ['Bitrix24', 'The task number in Bitrix, if the task was sent there.'],
          ],
        },
      ],
    },
    {
      id: 'cascade',
      title: 'Links and the cascade shift',
      blocks: [
        { kind: 'p', text: 'A link is created in two ways: drag from bar to bar on the Gantt chart, or pick a predecessor in the task card under "Depends on". The portal understands "finish → start": a successor does not begin before its predecessor ends.' },
        { kind: 'p', text: 'Move a predecessor and every successor down the chain moves by the same number of days, gaps included. This works the same whether you drag the bar or edit the date in the table. Only tasks with both planned dates filled in are moved.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'There is no automatic scheduling in the portal. It does not know weekends or the working calendar, does not level people’s workload and does not recalculate the plan against constraints. The only automation is shifting successors by the same delta; everything else is your call.',
        },
        { kind: 'p', text: 'The critical path is worked out by the portal and outlined in red. It is computed only across linked tasks: a task with no dependency at all will never be critical, however long it is. That is one more reason to link at least the key pieces of work.' },
      ],
    },
    {
      id: 'gantt',
      title: 'Gantt',
      blocks: [
        { kind: 'p', text: 'The chart is built from the same tasks. Drag a bar with the mouse and the dates in the table change, while the linked tasks move along with it.' },
        { kind: 'note', tone: 'info', text: 'If a phase shows no dates, the tasks inside it have none. The Gantt only draws what has dates.' },
      ],
    },
  ],
}

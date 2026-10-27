import type { WikiPage } from '../types'

export const portfolioMetricsPage: WikiPage = {
  slug: 'portfolio-metrics',
  title: 'How portfolio figures are calculated',
  summary: 'Health score, RAG status, schedule deviation in days and the data behind every chart.',
  group: 'portal',
  appRoute: () => '/portfolio',
  sections: [
    {
      id: 'basis',
      title: 'What everything else is built on',
      blocks: [
        { kind: 'p', text: 'The portfolio stores nothing of its own: every figure is recalculated from project tasks, risks and budgets the moment you open the page. That is why overdue counts grow by themselves even when nobody has touched the project.' },
        {
          kind: 'table',
          head: ['Term', 'What is actually counted'],
          rows: [
            ['Task', 'Ordinary tasks only. Phases are never counted — not in progress, not in overdue, not in workload.'],
            ['Overdue', 'The task is neither «Completed» nor «Cancelled», and its planned finish is earlier than today.'],
            ['Progress', 'Share of completed tasks out of all project tasks, rounded to whole percent. Hours and effort are ignored: ten small tasks weigh as much as ten large ones.'],
            ['Open risk', 'A risk whose status is neither «Closed» nor «Mitigated».'],
            ['Risk severity', 'Probability × impact (low 1, medium 2, high 3). 6 and above is high, 3–5 is medium, below that is low.'],
            ['Budget', 'Planned and actual totals of expense lines. If there are no lines, the approved limit from the passport is used.'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'Completed and cancelled projects are treated specially: their overdue count is shown as zero, health as 100 and RAG as green. Otherwise closed projects with loose ends would alarm the portfolio forever.' },
      ],
    },
    {
      id: 'health',
      title: 'Project health score',
      blocks: [
        { kind: 'p', text: 'This is the 0–100 number in the «Health» column. The portal starts at 100 and subtracts for what is visible in the project right now.' },
        {
          kind: 'table',
          head: ['What is deducted', 'How much', 'Deduction stops at'],
          rows: [
            ['Red RAG status', '−45', '—'],
            ['Amber RAG status', '−20', '—'],
            ['Each overdue task', '−3', '−30 (so from 10 overdue tasks it stops growing)'],
            ['Each open high risk', '−5', '−15 (from three risks)'],
            ['Progress below 10 %', '−5', '—'],
          ],
        },
        { kind: 'p', text: 'The result is clamped to 0…100. Example: an amber project with four overdue tasks and one high risk → 100 − 20 − 12 − 5 = 63.' },
        { kind: 'note', tone: 'tip', text: 'Health is mostly RAG and only then the details: almost half of the score is decided by the colour. A green project cannot fall below 50, a red one cannot rise above 55. Comparing health therefore makes sense within one colour.' },
        { kind: 'p', text: 'The «Overall status» donut at the top shows the average health of non-closed projects — a plain arithmetic mean, not weighted by budget or size.' },
      ],
    },
    {
      id: 'rag',
      title: 'RAG status (red / amber / green)',
      blocks: [
        { kind: 'p', text: 'RAG is calculated by the portal from overdue work and risks. The rules are checked top to bottom — the first one that matches gives the colour.' },
        {
          kind: 'table',
          head: ['Colour', 'When it is set'],
          rows: [
            ['Red', 'At least a quarter of the work and at least three items are overdue — OR there is an open high risk with no mitigation plan'],
            ['Amber', 'At least one item is overdue, OR at least one high risk is open, OR a medium risk is open'],
            ['Green', 'Everything else'],
          ],
        },
        { kind: 'p', text: 'Work means tasks of the work plan; phases are not counted. Overdue means not completed and not cancelled, with the planned end already past. A high risk is an open risk scoring 6 or more; «no plan» means its «Mitigation plan» field is empty. A closed project is always green.' },
        { kind: 'p', text: 'Thresholds live in «Settings», section «RAG». By default: red from 25 % of work overdue and at least 3 items, or one high risk with no plan; amber from one medium risk.' },
        { kind: 'note', tone: 'tip', text: 'A high risk on its own no longer turns a project red: an honestly logged risk with a mitigation plan is management, not an alarm. A project turns red when a risk exists and nobody has written down what to do about it.' },
        { kind: 'p', text: 'A red project appears in the «Needs attention» block, and expanding its row explains why: how many tasks are overdue, how many high risks are open, whether the budget is overrun.' },
      ],
    },
    {
      id: 'delta',
      title: 'Δ days — deviation from the baseline',
      blocks: [
        { kind: 'p', text: 'The column answers one question: how far the project finish has drifted from the way the project was planned. It is a subtraction of two dates: the latest planned finish among today’s tasks minus the latest planned finish in the last baseline snapshot. Positive means the finish moved right, negative means you are ahead.' },
        { kind: 'note', tone: 'warn', text: 'The column stays empty until a baseline is captured in the project. That is not a fault: there is nothing to compare with — the snapshot is the only memory of what the deadline originally was. Without a snapshot, the project row shows a dash.' },
        { kind: 'p', text: 'A dash also appears when:' },
        {
          kind: 'ul',
          items: [
            'no task in the snapshot has a planned finish;',
            'no task in the project has a planned finish today (cancelled ones do not count);',
            'the dates are stored in an unreadable form — the portal then honestly shows nothing instead of zero.',
          ],
        },
        {
          kind: 'steps',
          items: [
            { title: 'Wait for an agreed plan', text: 'The snapshot is taken from the current WBS, so capture it once the dates are agreed: it becomes the reference point.' },
            { title: 'Open the «Baseline» tab', text: 'In the project where you need the Δ days column.' },
            { title: 'Press «Capture version»', text: 'From that moment the portfolio shows the drift in days, and it grows on its own as tasks are moved.' },
          ],
        },
        { kind: 'note', tone: 'info', text: 'The comparison uses the LATEST snapshot. Capture a new baseline and the count restarts from zero; previous versions stay in the tab history.' },
      ],
    },
    {
      id: 'charts',
      title: 'Where the charts get their data',
      blocks: [
        { kind: 'p', text: 'The donuts at the top, «Project finish dates» and «Project manager load» are calculated from the same project list as the table — so they follow the filters and the search above the list. Narrow the portfolio down to one project kind and these charts narrow down too. Which donuts to show is each person’s own choice: the «Configure charts» link above them, saved to the account.' },
        {
          kind: 'table',
          head: ['Chart', 'What it counts'],
          rows: [
            ['By status / by kind / by priority', 'A plain count of projects by the passport value. Projects without a kind go to the «No kind» slice.'],
            ['By RAG status', 'A count of projects by the calculated colour (see above). The centre shows the number of red ones.'],
            ['Portfolio tasks', 'Totals across all projects: completed, overdue, everything else is «in progress». Phases are not counted.'],
            ['Open risks', 'The sum of open high and medium risks. Low risks are deliberately left out — they do not affect RAG.'],
            ['Portfolio budget', 'Planned and actual totals of expense lines across all projects. The «Actual» slice turns red once actual exceeds plan.'],
            ['Overall status', 'Average health of non-closed projects, «out of 100».'],
            ['Project finish dates', 'Projects are bucketed by the QUARTER of their planned finish for a year ahead; anything before today goes to «overdue», anything beyond a year to «later». Clicking a bar lists that period’s projects: code, name, manager, date. Closed projects and projects without a finish date are not shown.'],
            ['Portfolio trends', 'The only block built not from «now» but from daily snapshots: once a day the portal records how many projects were red/amber/green, how many tasks were overdue and how many were completed. History therefore appears gradually, and filters do not affect it.'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'Rows of the «Project registry» (the ones not created yet) count in the donuts where they carry real data: by project kind and by the RAG estimate. In the «By status» and «By priority» donuts they get their own «not created yet» slice — they have neither status nor priority, and inventing those would be dishonest. They do not affect tasks, risks, budget or the average health: no work on them has started.' },
        { kind: 'note', tone: 'info', text: '«Assignee load» is the exception: it is calculated across every project available to you and ignores the portfolio filters, because it answers «who is buried» for the company as a whole. The first 12 people by open task count are shown.' },
      ],
    },
    {
      id: 'overload',
      title: 'What «overloaded» means',
      blocks: [
        { kind: 'p', text: 'The «Overloaded» mark appears on two different charts and means different things there — they answer two different questions.' },
        {
          kind: 'table',
          head: ['Chart', 'What one row is', 'When it says «overloaded»'],
          rows: [
            ['Assignee load', 'A person and their open tasks across the whole portfolio (completed, cancelled and phases excluded)', '8 or more open tasks OR 80 or more estimated hours in total'],
            ['Project manager load', 'A manager, their non-closed projects and the registry rows assigned to them («0 +3» — runs none, three still to create; the grey part of the bar is those)', '4 or more projects in total OR at least one CREATED project is red. A red estimate on a row that does not exist yet is worth a conversation, but is not a load today'],
          ],
        },
        { kind: 'note', tone: 'warn', text: 'Estimated hours are filled in for far from every task. Where they are missing, only the task-count rule fires — so a person with five very heavy tasks will not look overloaded. That is a limitation of the data, not of the calculation: not everyone plans in hours.' },
        { kind: 'p', text: 'Both marks are a reason to look, not a verdict: eight small support tasks and eight rollout tasks are different lives. The thresholds are set by the portfolio manager in «Settings» → «Overload thresholds»: open tasks, estimated hours and projects per manager. Defaults are 8 tasks, 80 hours, 4 projects.' },
      ],
    },
  ],
}

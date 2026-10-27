import type { WikiPage } from '../types'

export const kpisPage: WikiPage = {
  slug: 'kpis',
  title: 'Success metrics (KPIs)',
  summary: 'How we will know the project succeeded, rather than merely ended.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/kpis`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'A project can be delivered on time and still produce no result. A KPI is an answer agreed in advance to the question “what should change”.' },
        { kind: 'note', tone: 'tip', text: 'A good KPI is measurable and has a formula: not “speed up request handling”, but “average handling time of a request — from 3 days to 1, measured from CRM data over a month”.' },
      ],
    },
    {
      id: 'fields',
      title: 'What a metric is made of',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Goal', 'The name of the metric: what exactly is being measured. Required.'],
            ['Status', 'On track, at risk or off track. Set by hand — the portal calculates nothing.'],
            ['Description', 'Context and — importantly — the target value: "from 3 days to 1", "not below 95%". There is no separate column for the number.'],
            ['Formula', 'How it is counted: where the data comes from, over what period, who takes the reading.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Putting the target value in "Description" is not a workaround but the intended way: the section holds an agreement about how to measure, not an automatic counter.',
        },
      ],
    },
    {
      id: 'statuses',
      title: 'Three statuses',
      blocks: [
        {
          kind: 'table',
          head: ['Status', 'When to set it'],
          rows: [
            ['On track', 'The metric is going to plan — ordinary monitoring is enough.'],
            ['At risk', 'Signs of drift have appeared. Act now, before it goes red.'],
            ['Off track', 'The target is no longer being met. That calls for a review and a decision, not another round of pushing harder.'],
          ],
        },
        { kind: 'p', text: 'Statuses are updated at the end of each reporting period, alongside the status report. A metric that has read "On track" for six months without a single edit usually means nobody has looked at it.' },
      ],
    },
    {
      id: 'howto',
      title: 'How to fill it in',
      blocks: [
        { kind: 'p', text: 'Aim for three metrics — the "On this page" panel keeps reminding you while there are fewer. For each one: how you count it, where it stood at the start and where you are heading. A metric without a formula turns into an argument about how to measure it within a month, and the panel watches for that separately.' },
        { kind: 'p', text: 'One metric is almost never enough: time, money and quality pull in different directions, and a project measured only on speed starts saving on everything else. Three to five metrics from different angles are the protection against that.' },
        { kind: 'note', tone: 'info', text: 'The portal does not calculate anything from these numbers and does not carry them anywhere: KPIs do not reach the status report or the portfolio. This is your agreement with the client about what counts as success — worth exactly as much as the regularity with which you come back to it.' },
      ],
    },
  ],
}

export const assumptionsPage: WikiPage = {
  slug: 'assumptions',
  title: 'Assumptions and constraints',
  summary: 'What the plan rests on and what we cannot change.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/assumptions`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'An assumption is something you treat as true without checking it: “the contractor starts in March”, “the data can be exported from the old system”. A constraint is something you cannot change: the budget, the deadline, a legal requirement.' },
        { kind: 'p', text: 'The point of the section is that assumptions have a habit of not coming true. Written down, an assumption becomes a risk in good time; left unwritten, it becomes a surprise.' },
      ],
    },
    {
      id: 'kinds',
      title: 'Three kinds of entry',
      blocks: [
        {
          kind: 'table',
          head: ['Type', 'What it is', 'Example'],
          rows: [
            ['Assumption', 'Something you treat as true at the start and build the plan on until facts arrive.', '"The client hands over test data by 1 March."'],
            ['Constraint', 'A hard boundary you cannot freely move: budget, deadline, resource, technology, rule.', '"The budget is 40,000 euro and cannot grow."'],
            ['Dependency', 'An external factor or work by other people that you rely on but do not control.', '"Until the mail migration is finished, the integration cannot be switched on."'],
          ],
        },
        { kind: 'p', text: 'The difference is practical. An assumption gets checked and may collapse. A constraint is not checked — you live with it and plan inside it. A dependency is tracked at the neighbours: more often than not, that is what breaks the schedule.' },
      ],
    },
    {
      id: 'howto',
      title: 'How to fill it in',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Description', 'The whole statement, phrased so an outsider gets it. Required.'],
            ['Type', 'Assumption, constraint or dependency.'],
            ['Owner', 'Who will check that it still holds.'],
            ['Status', 'Active (needs watching), Confirmed (checked and true), Invalid (turned out to be wrong).'],
          ],
        },
        { kind: 'note', tone: 'warn', text: 'The owner is stored here as plain text, not as a link to a person. A typo in the surname, or "IT department" instead of a name, means the entry never shows up in that person’s "My tasks" — pick from the directory suggestions.' },
        { kind: 'p', text: 'The "Invalid" status is the most valuable thing in the section and the one most often left unset. A collapsed assumption means the plan was resting on something untrue, and the portal will only remind you about it in the panel on the right: carrying the consequences into the work plan and raising a risk is up to you.' },
        { kind: 'p', text: 'A rhythm of running down the list every couple of weeks and updating the statuses is enough. An assumption nobody has revisited since kick-off is not an assumption any more — it is a hope.' },
      ],
    },
  ],
}

export const commPlanPage: WikiPage = {
  slug: 'comm-plan',
  title: 'Communication plan',
  summary: 'Who we keep informed, about what, and how often.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/comm-plan`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'The most common complaint about projects is “nobody warned us”. The communication plan settles that in advance: you agree once who gets what, and from then on it simply runs.' },
      ],
    },
    {
      id: 'fields',
      title: 'What a row is made of',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Purpose', 'Why it exists: "keep the sponsor across the risks", "sync the team on the tasks of the week". Required.'],
            ['Channel', 'How exactly: email, a Teams meeting, a page in the knowledge base, a chat.'],
            ['Audience', 'Who for: the steering committee, the team, end users, a particular department.'],
            ['Frequency', 'How often: weekly, fortnightly, at the end of each stage.'],
            ['Responsible', 'Who prepares and sends it. Pick from the directory — that person then sees the entry in their "My tasks".'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'The portal sends nothing on the strength of this plan: it will not email anyone on Friday and will not remind anyone about a meeting. This is an agreement between people, not automation — the one thing the portal does is show the entry to the responsible person in their own list.' },
      ],
    },
    {
      id: 'howto',
      title: 'How to fill it in',
      blocks: [
        { kind: 'p', text: 'Two rows at the very least: how you report upwards and how the team keeps in sync. Each one needs a responsible person and a frequency, otherwise the agreement turns into a wish — and that is exactly what the "On this page" panel checks.' },
        { kind: 'p', text: 'A good check is to walk down the stakeholders in the top half of the influence matrix and make sure each of them appears somewhere in this plan. A high-influence person with not one line about them is a future "why am I the last to hear about this?".' },
        { kind: 'note', tone: 'tip', text: 'Three to five rows are enough. A communication plan of fifteen entries never gets followed — and the first thing to lapse is whatever actually mattered.' },
      ],
    },
  ],
}

export const kanbanPage: WikiPage = {
  slug: 'kanban',
  title: 'Task board',
  summary: 'The same work plan, laid out by status.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/kanban`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'The board is not a separate list: it is the same tasks from the work breakdown, spread across status columns. Handy for running a stand-up — you can see what is stuck.' },
        { kind: 'p', text: 'Drag a card into another column and the task status changes in the table and in the reports too.' },
      ],
    },
    {
      id: 'look',
      title: 'What it looks like',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/kanban.png', alt: 'Task board with columns by status' },
      ],
    },
  ],
}

export const baselinePage: WikiPage = {
  slug: 'baseline',
  title: 'Baseline',
  summary: 'A snapshot of the agreed plan that actual progress is later compared against.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/baseline`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'Once the plan is agreed, you take a snapshot of it. Dates may move afterwards — but you can always see how far they have drifted from what was agreed.' },
        { kind: 'p', text: 'Without a baseline, “we moved it by two weeks” turns into “that was the plan all along”.' },
      ],
    },
    {
      id: 'when',
      title: 'When to take it',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'Take the baseline LAST — once all the tasks are in. A task added after the snapshot will be counted as one that appeared on top of the plan, even if it was agreed in advance.',
        },
        { kind: 'p', text: 'The readiness test is simple: you have shown the work plan to the customer and they are not arguing. Before that moment the snapshot captures a draft, and every later deviation turns out to be a deviation from a draft.' },
        { kind: 'p', text: 'A snapshot is taken with the "Save baseline" button. Give it a name — that is how you will recognise it later: "Approved 15.09", "After the pilot was moved", "Board version". Unnamed snapshots are indistinguishable in three months.' },
      ],
    },
    {
      id: 'compare',
      title: 'How to read the deviation',
      blocks: [
        { kind: 'p', text: 'Pick a snapshot and the portal shows the difference between it and the current plan: which tasks moved and by how many days, which appeared after the snapshot, which are gone. Rows with a shift stand out; the rest stay out of the way.' },
        { kind: 'p', text: 'In "Compare with" you can pick another snapshot instead of the current plan. Then two agreed plans are compared with each other — useful when dates were formally rescheduled and you want to show what changed between two agreements rather than between the plan and today.' },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A deviation is material for a conversation, not an accusation. "We are 12 days behind, 10 of them waiting for contractor access" works better than "we are 12 days behind".',
        },
        {
          kind: 'shot',
          src: '/wiki-shots/baseline.png',
          alt: 'Comparing the current plan with a snapshot: the shift in days for each task',
          caption: 'The "plan changed since the snapshot" filter leaves only the rows that moved — that is where the conversation starts.',
        },
      ],
    },
    {
      id: 'howmany',
      title: 'How many snapshots to keep',
      blocks: [
        { kind: 'p', text: 'One is mandatory: the original, agreed one. After that a new snapshot is taken when dates are formally re-agreed — a stage moved, scope added, delivery shifted. Not after every edit, or the history turns into noise and there is nothing left to compare against.' },
        { kind: 'p', text: 'In practice: two to four snapshots per project. If there are ten, the plan was being rewritten instead of managed.' },
      ],
    },
  ],
}

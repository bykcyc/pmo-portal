import type { WikiPage } from '../types'

export const budgetPage: WikiPage = {
  slug: 'budget',
  title: 'Budget',
  summary: 'Expense and income items spread across months: plan, actuals and what is left.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/budget`,
  sections: [
    {
      id: 'why',
      title: 'Why',
      blocks: [
        { kind: 'p', text: 'If the project has money, this is where it is counted. The tab answers three questions: how much was set aside, how much is already spent, and whether it will last. If the project has no budget, leave the tab alone — it is not mandatory.' },
        { kind: 'p', text: 'There is exactly one reason to keep the budget in the portal rather than in your own spreadsheet: these numbers reach the status report and the portfolio by themselves. A file on your disk does not, and once a month you will be retyping it by hand.' },
      ],
    },
    {
      id: 'structure',
      title: 'What it is made of',
      blocks: [
        { kind: 'p', text: 'A budget is a list of items. An item is created once and lives for the whole project.' },
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Name', 'Something a human recognises: "Contractor development", "Annual licences", "Operator training".'],
            ['Category', 'From the list. Expenses and income have separate sets — an income category cannot end up among expenses.'],
            ['Amount (plan)', 'The total set aside for this item across the whole project.'],
            ['Notes', 'The basis: contract number, who approved it, where the figure came from.'],
          ],
        },
        { kind: 'p', text: 'Expense categories: labour, contractors and consultants, materials, equipment, software and licences, travel, facilities, overhead, marketing, training, legal and insurance, contingency reserve, other. Income ones: services, product sales, subscriptions, investment, grants, licensing, commissions and partnerships, rental, advertising, interest, other.' },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Keep the contingency reserve as its own item rather than a cushion smeared across the others. Then it is visible how much of it is left, and the conversation with management is about a number instead of a feeling.',
        },
      ],
    },
    {
      id: 'views',
      title: 'Two views: estimates and monthly',
      blocks: [
        { kind: 'p', text: 'There is a switch at the top. "Estimates" is the plain list of items with totals. "Monthly" is the same table unfolded across the months of the selected year, with plan and actual in every cell.' },
        { kind: 'p', text: 'They work together: in "Estimates" you say how much money the item gets in total; in "Monthly", when exactly it is spent. The "Free" column shows the difference — how much of the planned amount has not been assigned to any month yet. Zero there means the plan is fully laid out.' },
        {
          kind: 'shot',
          src: '/wiki-shots/budget-monthly.png',
          alt: 'The monthly budget plan: plan and actual rows across the months of the year',
          caption: 'Every item has two rows: the plan for the month and the actual for it. The button at the top of the tab reads "Monthly plan".',
        },
      ],
    },
    {
      id: 'fact',
      title: 'How to enter actuals',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'Actuals are entered MONTH BY MONTH only. The "Amount (actual)" column in the main list is not an input — it is the sum of the monthly cells. Type an actual anywhere else and it will not show up in the list, and you will be staring at an empty column while the money is spent.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Switch to "Monthly"', text: 'And pick the year — the table shows one year at a time.' },
            { title: 'Find the item row and the month', text: 'Each cell holds two numbers: the plan for that month and the actual for it.' },
            { title: 'Enter the actual for a CLOSED month', text: 'An actual in the future means the money has already been spent ahead of time. The portal will not stop you, but the numbers stop meaning what they should.' },
          ],
        },
        { kind: 'p', text: 'A comfortable rhythm is once a month, in the first few days: close the month, enter the actuals for every item, look at the variance. That is five minutes when done regularly and half a day when remembered at the end of a quarter.' },
      ],
    },
    {
      id: 'checks',
      title: 'What to check before a report',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The monthly plans add up to the item plan — otherwise "Free" shows a remainder that does not exist.',
            'Every past month has an actual, even a zero: an empty cell and "we spent nothing" are different things that look identical.',
            'Large variances are explained in the notes. In six months you will not remember why March came out twice as high.',
          ],
        },
        { kind: 'p', text: 'The "On this page" panel on the right points out what is missing: it checks the same things a live manager would, only it never forgets.' },
      ],
    },
  ],
}

export const reportsPage: WikiPage = {
  slug: 'reports',
  title: 'Status reports',
  summary: 'Ten minutes a week, and management is informed without a single call.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/reports`,
  sections: [
    {
      id: 'why',
      title: 'Why',
      blocks: [
        { kind: 'p', text: 'A short regular report replaces status calls: your manager does not have to ask how things are going, and you do not have to tell five people in turn.' },
        { kind: 'p', text: 'The second purpose shows up later. Reports pile up into the project’s history, and six months on it is visible when things went wrong, what was decided then and why. Without that, a post-mortem turns into an argument about who remembers what.' },
      ],
    },
    {
      id: 'rag',
      title: 'Green, amber, red',
      blocks: [
        { kind: 'p', text: 'The colour is set separately for three lines: the project overall, the schedule and the budget. A project can be fine on money and late on dates — those are different conversations.' },
        {
          kind: 'table',
          head: ['Colour', 'Meaning', 'What the manager does'],
          rows: [
            ['Green', 'On plan, no intervention needed.', 'Nothing. Reads it and closes it.'],
            ['Amber', 'There is a deviation, we are handling it, but you should know.', 'Keeps an eye on it, gets ready to help.'],
            ['Red', 'Help or a decision from above is needed.', 'Steps in: people, money or a decision.'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Amber and red without "Next steps" are useless and irritating: the manager needs to know not only what is wrong, but what you intend to do and what you need from them.',
        },
        { kind: 'p', text: 'A common mistake is holding green to the last moment so as not to worry anyone. Amber on time costs less than red out of nowhere — by then there is barely anything left to help with.' },
      ],
    },
    {
      id: 'auto',
      title: 'What the portal fills in',
      blocks: [
        { kind: 'p', text: 'When a report is created it pulls in the key tasks of the period and a budget snapshot: plan, actual and forecast as of the report date. There is no need to retype figures — check them and add in words what the numbers do not show.' },
        { kind: 'p', text: 'Hence a simple consequence: tidy up the work plan and the budget first, then create the report. In the other order you get a snapshot of emptiness and end up editing it by hand.' },
      ],
    },
    {
      id: 'rhythm',
      title: 'Rhythm and rules',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Weekly or fortnightly — but on the same day. Predictability matters more than frequency.',
            'A report is a snapshot on a date. Old ones are not rewritten: a wrong report stays in the history and a new one appears next to it with the correction.',
            'Write so that someone who did not read the previous report understands. "Work on task 3.2 continues" says nothing.',
            'Bad news goes first. That is what people look for.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A finished report is exported to PDF with the print button and then attached to an email or dropped into a chat. Sending from the portal is off by default and is switched on with the SMTP setting.',
        },
      ],
    },
  ],
}

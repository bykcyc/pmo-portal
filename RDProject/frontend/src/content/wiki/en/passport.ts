import type { WikiPage } from '../types'

export const passportPage: WikiPage = {
  slug: 'passport',
  title: 'Project passport',
  summary: 'The project at a glance: goal, manager, dates, status.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/passport`,
  sections: [
    {
      id: 'what',
      title: 'What it is',
      blocks: [
        { kind: 'p', text: 'The passport answers the question "what is this project" for anyone who sees it for the first time: why it exists, who runs it, by when, and what state it is in.' },
        { kind: 'p', text: 'The minimum without which a project cannot be discussed is the goal, the project manager and the planned end date. Until they are there, the portal keeps reminding you in the panel on the right.' },
      ],
    },
    {
      id: 'look',
      title: 'What it looks like',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/passport.png', alt: 'Project passport: the form with goal, manager and dates',
          caption: 'The passport form is on the left, hints and the project readiness progress on the right.' },
      ],
    },
    {
      id: 'fields',
      title: 'Fields',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Name', 'Short and recognisable. The project code is assigned by the portal itself.'],
            ['Goal', 'Why the project exists. Not a list of tasks but an outcome: what will change once it is done.'],
            ['Project result', 'What exactly the company gets: a product, a document, a process up and running.'],
            ['Scope', 'What is part of the project and, just as important, what is NOT.'],
            ['Project manager', 'Who is accountable. Picked from the people directory.'],
            ['Client', 'Who we are doing it for.'],
            ['Status and priority', 'Planning / active / on hold / completed.'],
            ['Planned dates', 'Start and finish. The portal will not let you set a finish earlier than the start.'],
          ],
        },
      ],
    },
    {
      id: 'versions',
      title: 'Version and history',
      blocks: [
        { kind: 'p', text: 'Edits made by one person in a row are glued into a single version: the number does not grow with every comma you type. A session lasts fifteen minutes — after a pause the next edit starts a new version. Another person’s edits never merge with yours.' },
        { kind: 'p', text: 'If by the end of a session you have put everything back as it was, the entry disappears and the version number rolls back: the portal does not count a version in which nothing changed.' },
        { kind: 'note', tone: 'tip', text: 'The padlock button next to printing fixes the version deliberately. It is needed in exactly one case: the passport has gone out for approval or to print, and version 1.0003 must not mean a different document an hour later.' },
      ],
    },
    {
      id: 'saving',
      title: 'Saving',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'The passport saves itself a couple of seconds after you stop typing. There is no "Save" button: next to the heading you see "Saving…" and then "Saved at 14:32".',
        },
        { kind: 'p', text: 'If you try to leave the page with unsaved edits — to another section, through a link inside the passport, through the left menu or by closing the tab — the portal asks what to do: save and continue, continue without saving, or stay.' },
      ],
    },
    {
      id: 'derived',
      title: 'What the portal works out itself',
      blocks: [
        { kind: 'p', text: 'The project code is assigned on creation and cannot be edited. The progress you see in the project list and the portfolio is the share of finished tasks, not an average of the "Progress" column: the percentages of individual tasks do not go into it.' },
        { kind: 'p', text: 'The "Key stages" block in the passport is the phases of your work plan. It is not filled in separately: phases appear in the plan, stages appear here.' },
      ],
    },
    {
      id: 'extras',
      title: 'What else is on the page',
      blocks: [
        {
          kind: 'ul',
          items: [
            'PDF — the button opens the browser print dialogue, and from there you can save the passport as a file.',
            'Linked sections — below the form you see the team, risks, KPIs and key tasks. The "Open" button takes you straight to the section you need.',
            'Action log — who changed what in the project.',
            'Transfer PM — hand the project to another project manager; co-managers are added in the same place.',
          ],
        },
      ],
    },
  ],
}

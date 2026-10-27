import type { WikiPage } from '../types'

export const rolesPage: WikiPage = {
  slug: 'roles',
  title: 'Roles and permissions',
  summary: 'Why different people see different things in the portal.',
  group: 'start',
  sections: [
    {
      id: 'two-roles',
      title: 'Two roles',
      blocks: [
        { kind: 'p', text: 'The portal has only two roles, and the difference between them is coverage, not who is “more senior”.' },
        {
          kind: 'table',
          head: ['Role', 'What they see and can do'],
          rows: [
            ['Project manager', 'Their own projects (where they are the PM or a co-PM) — in full and with the right to edit. Projects run by others are not visible at all.'],
            ['Portfolio manager', 'Every project in the company, plus the “Portfolio” and “Settings” sections. Can edit any project and create users.'],
          ],
        },
      ],
    },
    {
      id: 'co-pm',
      title: 'Co-manager',
      blocks: [
        { kind: 'p', text: 'A project can be shared: a co-PM gets the same rights on that project as the lead manager. You add them in the project header, in the same place as “Transfer PM”.' },
        { kind: 'p', text: 'Only the lead PM or the portfolio manager can manage the list of co-managers.' },
      ],
    },
    {
      id: 'can',
      title: 'Who can do what',
      blocks: [
        {
          kind: 'table',
          head: ['Action', 'Project manager', 'Co-manager', 'Portfolio manager'],
          rows: [
            ['Create a project', 'yes', 'yes', 'yes'],
            ['Edit their own project', 'yes', 'yes', 'yes'],
            ['See someone else’s project', 'no', 'no', 'yes'],
            ['Add a co-manager', 'yes', 'no', 'yes'],
            ['Hand the project to another manager', 'yes', 'no', 'yes'],
            ['Archive a project', 'yes', 'yes', 'yes'],
            ['Public link and the assistant lock', 'yes', 'yes', 'yes'],
            ['Portfolio and Settings', 'no', 'no', 'yes'],
            ['Create users and directory people', 'no', 'no', 'yes'],
          ],
        },
        { kind: 'p', text: 'Handing over a project changes its main manager: the previous one loses access unless they are kept as a co-manager. Changing a person’s name in their profile rewrites the "Project manager" line across all of their projects at once.' },
        { kind: 'note', tone: 'warn', text: 'Archiving hides the project from your list, and only the portfolio manager can bring it back — the project list has no "show archive" filter at all. Save the link to the project before archiving, or warn the portal owner.' },
      ],
    },
    {
      id: 'why-empty',
      title: 'Why my screen is empty',
      blocks: [
        {
          kind: 'ul',
          items: [
            'The project list is empty — no project has been assigned to you yet. Create your own, or ask to be added as a co-manager.',
            '“My tasks” is empty — nothing is assigned to you personally. For a portfolio manager that is normal.',
            'There is no “Portfolio” or “Settings” item — those belong to the portfolio manager only.',
            'The portal shows only the 2FA setup dialog — the deadline for setting it up has passed (seven days from the first sign-in). Set it up and access comes back.',
            '"My tasks" is empty although tasks are assigned to you — the assignee was typed as text instead of picked from the directory. The portal recognises people through the directory only.',
            'A project vanished from the list — it has been archived or handed to another manager.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Showing the project to people without access',
      blocks: [
        { kind: 'p', text: 'The “Share” button in the project header creates a public link — the project can be viewed through it without signing in to the portal. You choose which sections to show: you can open just the passport and the plan without revealing the budget.' },
        { kind: 'note', tone: 'warn', text: 'The link works for anyone who receives it. Contact details of people are hidden on the public page, but everything else is visible — do not post it where it is not needed.' },
      ],
    },
  ],
}

import type { WikiPage } from '../types'

export const teamPage: WikiPage = {
  slug: 'team',
  title: 'Team and roles',
  summary: 'Who takes part in the project and what each person is responsible for.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/team`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'A list of members with their roles. It answers the question "who do I go to" when something is unclear, and it stops the project from resting on one person.' },
        { kind: 'p', text: 'There is a simple test for it: if you went on holiday tomorrow, could an outsider work out from this list who builds the integration, who signs the work off and who to call when a server goes down? If not, the list is being kept for show.' },
        { kind: 'note', tone: 'tip', text: 'A role in the project is not a job title. "Analyst", "rollout lead", "tests it from the accounting side" say far more than "senior specialist".' },
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
            ['Name', 'Pick from the people directory. Free text is only for someone who is not in it.'],
            ['Position', 'Filled in from Bitrix24 automatically. This is the person’s job title, not what they do on the project.'],
            ['Project role', 'What this person does here. Required — while it is empty, the portal keeps reminding you.'],
            ['Email and phone', 'Filled in from the directory. Type them by hand only if the person is not there.'],
          ],
        },
        { kind: 'p', text: 'Picking someone from the directory is not a formality or a typing shortcut: that is what links the row to a real portal person. Whether tasks reach their "My tasks" section, and whether they get notified at all, depends on that link.' },
        { kind: 'note', tone: 'warn', text: 'A name typed as plain text links to nobody. The row looks exactly the same, so the mistake is usually spotted late — normally when the person says they have never seen a single task on the project.' },
      ],
    },
    {
      id: 'howto',
      title: 'Who to include',
      blocks: [
        { kind: 'p', text: 'Everyone who actually does the work and who you will deal with: the doers, the analyst, the tester on the client’s side, the contractor’s representative. Managers who influence the project without working on it do not belong here — they go to "Stakeholders".' },
        { kind: 'p', text: 'Contractors and external consultants are worth including: they are part of the working team even without a portal account. Their project role matters all the more — it is what tells you later what to hold them to.' },
        { kind: 'p', text: 'The list is alive. When someone leaves the project, the row is not quietly deleted at the end but updated as you go: a list that has drifted from reality is worse than an empty one, because people call the wrong person from it.' },
      ],
    },
    {
      id: 'access',
      title: 'Team is not access',
      blocks: [
        { kind: 'p', text: 'Adding someone to the team does not open the project for them in the portal. The right to see and edit a project comes only from being made a co-manager (in the project header, next to "Transfer PM") or from the portfolio manager role.' },
        { kind: 'p', text: 'What a team member does see is whatever is assigned to them in "My tasks": tasks, action items, risks they own. The project itself will not open, and that is not a bug — it is the difference between "the work is on me" and "I run this project".' },
      ],
    },
  ],
}

export const stakeholdersPage: WikiPage = {
  slug: 'stakeholders',
  title: 'Stakeholders and influence',
  summary: 'People who influence the project or depend on it — and how to work with them.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/stakeholders`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'A stakeholder is not a team member but someone whose opinion can speed the project up or bring it to a halt: the sponsor, the client, the head of a neighbouring department, sometimes an external partner.' },
        { kind: 'p', text: 'At least two of them should always be there: the sponsor (who provides the resources) and the client (who we are doing it for). After that, everyone the project touches: whose department has to change how it works, who approves the purchase, whose data you intend to move.' },
        { kind: 'note', tone: 'tip', text: 'Projects rarely stall over technology. Far more often it is a person somebody remembered two weeks later than they should have.' },
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
            ['Name', 'From the directory — then the email and phone fill themselves in.'],
            ['Role', 'Their role towards the project: sponsor, client, approver, head of a neighbouring department.'],
            ['Type', 'Internal or external. External ones move at a different speed: you cannot pull them into a stand-up or write "drop by and I will explain".'],
            ['Influence and interest', 'Two scores from 1 to 10. The matrix is built from them.'],
            ['Engagement strategy', 'What you actually do with this person: "weekly call", "demo every sprint", "a note at the end of each stage".'],
            ['Notes', 'What is useful to know: what they are wary of, what matters to them, whose opinion they follow.'],
          ],
        },
      ],
    },
    {
      id: 'matrix',
      title: 'Influence and interest',
      blocks: [
        { kind: 'p', text: 'Influence is how far the person can affect the fate of the project. Interest is how much it matters to them. Both are scored from 1 to 10, and the portal treats 6 and above as high. Score actual weight, not job title: on a rollout project the warehouse supervisor often has more influence than the director.' },
        {
          kind: 'table',
          head: ['Combination', 'Quadrant in the portal', 'What to do'],
          rows: [
            ['High influence, high interest', 'Manage closely', 'Keep them closely involved: this is your ally or your main risk.'],
            ['High influence, low interest', 'Keep satisfied', 'Do not lose sight of them: if they hear about it late, they will turn the project around.'],
            ['Low influence, high interest', 'Keep informed', 'Keep them informed and use them as a source of feedback.'],
            ['Low influence, low interest', 'Monitor', 'A general mailing is enough.'],
          ],
        },
        { kind: 'p', text: 'The quadrant is worked out automatically and shown right in the table, and at the bottom of the tab the same people are laid out on the matrix. Its one practical use: everyone in the top half should have an engagement strategy written down. If that is blank, you are working with that person on instinct.' },
        { kind: 'note', tone: 'info', text: 'Without both scores a person will not appear in the matrix — it will stay half empty.' },
      ],
    },
  ],
}

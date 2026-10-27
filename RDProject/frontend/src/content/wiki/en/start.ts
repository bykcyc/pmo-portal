import type { WikiPage } from '../types'

export const startPage: WikiPage = {
  slug: 'start',
  title: 'Where to start',
  summary: 'First sign-in, two-factor authentication, and the minimum that already makes a project live.',
  group: 'start',
  sections: [
    {
      id: 'login',
      title: 'First sign-in',
      blocks: [
        { kind: 'p', text: 'The portal opens at your installation’s address. The portfolio manager gives you your login and password.' },
        {
          kind: 'steps',
          items: [
            { title: 'Sign in', text: 'Your login is your work email, the password is the one you were given.' },
            { title: 'Set up two-factor authentication', text: 'The portal asks for it by itself: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password) and enter the six-digit code.' },
            { title: 'Change your password', text: 'The “Profile” section. You are not the only one who knows the password you were given, so it is better to replace it with your own.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Two-factor authentication is mandatory. You get a few days after the first sign-in to set it up; once that window closes, the portal stops showing data and displays only the 2FA setup dialog. Nothing is broken — just set it up and access comes back.',
        },
      ],
    },
    {
      id: 'minimum',
      title: 'The minimum that makes a project live',
      blocks: [
        { kind: 'p', text: 'There is no need to fill in every section at once. Two are enough, the rest is added as you go.' },
        {
          kind: 'steps',
          items: [
            { title: 'Create the project', text: 'The “Create project” button in the “Projects” section. On the first step you only need a name — the portal assigns the project code itself.' },
            { title: 'Fill in the passport', text: 'The goal, the manager, and the planned finish. This is the minimum without which a project cannot be discussed.' },
            { title: 'List the tasks', text: 'The “Work breakdown (WBS)” section: what has to be done, by when, and who is responsible.' },
          ],
        },
        { kind: 'note', tone: 'tip', text: 'You do not have to draw the Gantt separately — it is built from tasks with dates. The board too: it is the same list, laid out by status.' },
      ],
    },
    {
      id: 'next',
      title: 'What to add later',
      blocks: [
        {
          kind: 'table',
          head: ['Section', 'What it is for'],
          rows: [
            ['Team and roles', 'Who takes part and who is responsible for what'],
            ['Risk register', 'What can go wrong and who keeps an eye on it'],
            ['Decisions log', 'Why it was done this way and not another — six months on, this saves you'],
            ['Budget', 'Plan and actuals by month'],
            ['Meetings', 'Agenda, decisions, and action items — nothing gets forgotten'],
            ['Status report', '10 minutes a week, and management stays informed without calls'],
          ],
        },
        { kind: 'p', text: 'Every section has a “How to use” button — a short instruction for that very page. And the “On this page” panel on the right points out what the project is missing right now.' },
      ],
    },
    {
      id: 'help',
      title: 'If something is wrong',
      blocks: [
        { kind: 'p', text: 'The portal is still being developed, so something may work oddly or feel awkward. That is normal, and it is worth telling us about.' },
        { kind: 'p', text: 'At the bottom of the left menu there is a “Report a problem” button. Describe what happened — the portal attaches a screenshot, and your note goes straight to the developer.' },
      ],
    },
  ],
}

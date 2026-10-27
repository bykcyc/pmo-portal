import type { WikiPage } from '../types'

export const projectsPage: WikiPage = {
  slug: 'projects',
  title: 'Project list',
  summary: 'All your projects: creating, searching, the archive, templates.',
  group: 'portal',
  appRoute: () => '/projects',
  sections: [
    {
      id: 'list',
      title: 'The list',
      blocks: [
        { kind: 'p', text: "Here you see the projects you manage or co-manage. Other people's projects never show up — that is not a fault, it is how access is separated." },
        { kind: 'p', text: 'The view switches between cards and a table; in the table, columns sort when you click a heading. There are status filters and a search box.' },
      ],
    },
    {
      id: 'create',
      title: 'Creating a project',
      blocks: [
        { kind: 'p', text: 'Use the “Create project” button. The first step needs only a name — the portal assigns the code itself. The wizard then offers to add your first tasks right away, but that is optional.' },
        { kind: 'p', text: 'Next to it sits the Excel import: if the project is already described in your own file (passport, work plan, risks), you can pull the whole thing in.' },
      ],
    },
    {
      id: 'whose',
      title: 'Whose list this is',
      blocks: [
        { kind: 'p', text: 'A project manager sees their own projects here — the ones where they are the main manager or a co-manager. The portfolio manager sees every project in the company in the same list. An empty list for a new manager is not a fault: no projects have been assigned yet.' },
        { kind: 'note', tone: 'info', text: 'The "PM" filter in the project list matches the main manager only. The same filter in the Portfolio also counts co-managers — which is why two identical-looking filters give different answers.' },
      ],
    },
    {
      id: 'lifecycle',
      title: 'Archive, template, copy',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Archive — the project is finished and should stop cluttering the list. Nothing is lost, but the project list has no "show archive" filter: only the portfolio manager can bring a project back. Save the link to the project before archiving it.',
            'Template — a starting point for similar projects: the work breakdown and the sections are kept, the data of that particular project is not.',
            'Copy — a full duplicate of a project, for when the next one is “like that one, only for a different department”.',
          ],
        },
      ],
    },
    {
      id: 'look',
      title: 'How it looks',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/projects.png', alt: 'Project list with filters' },
      ],
    },
  ],
}

export const portfolioPage: WikiPage = {
  slug: 'portfolio',
  title: 'Project portfolio',
  summary: 'A view across every project in the company. Visible to the portfolio manager.',
  group: 'portal',
  appRoute: () => '/portfolio',
  sections: [
    {
      id: 'who',
      title: 'Who can see it',
      blocks: [
        { kind: 'p', text: 'Only the portfolio manager sees the portfolio. A project manager has no such menu item — and rightly so: the project manager view is called “My tasks”.' },
      ],
    },
    {
      id: 'what',
      title: 'What it shows',
      blocks: [
        { kind: 'p', text: 'A summary of every project at once: how many are active, how many are overdue, the total budget, portfolio health. Below are project cards you can group by client, program or kind.' },
        { kind: 'p', text: 'Separately there is a risk heatmap, workload per person and the nearest key dates — this is the “what is on fire across the company” view, not the one for a single project.' },
      ],
    },
  ],
}

export const profilePage: WikiPage = {
  slug: 'profile',
  title: 'Profile and two-factor authentication',
  summary: 'Password, 2FA, language and appearance.',
  group: 'portal',
  appRoute: () => '/profile',
  sections: [
    {
      id: 'password',
      title: 'Password',
      blocks: [
        { kind: 'p', text: 'The password the portfolio manager gave you is worth changing: you are not the only one who knows it. Change it in “Profile” — you will be asked to confirm the current password.' },
      ],
    },
    {
      id: 'twofa',
      title: 'Two-factor authentication',
      blocks: [
        { kind: 'p', text: 'Signing in takes two steps: your password and a six-digit code from an authenticator app. You set it up once: the portal shows a QR code, you scan it with the app and enter a code to verify.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'This is required. You get a few days from your first sign-in to set it up; once the deadline passes, the portal stops showing data and leaves only the 2FA setup dialog. If you missed it, simply set 2FA up — access comes back straight away.',
        },
        { kind: 'p', text: 'Lost your phone — ask the portfolio manager: they can reset your 2FA so you can set it up again.' },
      ],
    },
    {
      id: 'assistant',
      title: 'Assistant connection',
      blocks: [
        { kind: 'p', text: 'At the bottom of the Profile is the address you paste into your ChatGPT or Claude, a "Copy" button next to it, and a list of what is already connected: where it is used, when it was last used and until when it is valid.' },
        { kind: 'p', text: 'You can disconnect it there with one button — the assistant loses access immediately. A separate line, "The client asks for a token", reveals token issuing: it is only needed by clients that cannot confirm in a browser.' },
        { kind: 'p', text: 'For the details of connecting, and of what the assistant does and does not see, go to "Connecting an assistant".' },
      ],
    },
    {
      id: 'look-and-feel',
      title: 'Language and appearance',
      blocks: [
        { kind: 'p', text: 'The interface language (Russian, English, Latvian) is switched at the bottom of the left menu, along with the light and dark theme. In “Profile” you pick the appearance: the warm Warm theme or Classic.' },
      ],
    },
  ],
}

export const settingsPage: WikiPage = {
  slug: 'settings',
  title: 'Portal settings',
  summary: 'Users, the people directory, Bitrix24, health thresholds. Portfolio manager only.',
  group: 'portal',
  appRoute: () => '/settings',
  sections: [
    {
      id: 'who',
      title: 'Who can see it',
      blocks: [
        { kind: 'p', text: 'The section is visible to the portfolio manager only: this is where access is granted and the portal as a whole is configured.' },
      ],
    },
    {
      id: 'people',
      title: 'People and users',
      blocks: [
        { kind: 'p', text: 'The people directory holds every employee pulled in from Bitrix24. Assignees and participants are picked from it. The fetch button refreshes the directory: new employees, phone numbers and job titles come in.' },
        { kind: 'p', text: 'Portal users are the people who can sign in. An account can be created straight from a directory row: the portal generates a password and shows it once.' },
        { kind: 'note', tone: 'tip', text: 'The “Hidden” checkbox keeps technical accounts out of the people pickers so they do not get in the way when you assign someone. The person stays in the directory itself.' },
      ],
    },
    {
      id: 'rest',
      title: 'Everything else',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Bitrix24 — the webhook address and a connection test.',
            'Health thresholds — how many high risks and overdue tasks turn a project red.',
            'Problem reports — everything sent through the “Report a problem” button, with screenshots.',
            'Sync log — what was exchanged with Bitrix24, and when.',
          ],
        },
      ],
    },
  ],
}

export const bitrixPage: WikiPage = {
  slug: 'bitrix',
  title: 'Bitrix24 connection',
  summary: 'Tasks, calendar and time-picking — without doing the work twice.',
  group: 'portal',
  sections: [
    {
      id: 'tasks',
      title: 'Tasks',
      blocks: [
        { kind: 'p', text: 'A task from the work plan can be sent to Bitrix24 — the assignee is used to working there, and there is no need to duplicate it by hand. The project manager is set as the creator, and the task assignee as the responsible person.' },
        { kind: 'p', text: 'The status comes back: close the task in Bitrix and the portal picks that up. Sync runs when you open the project, and from the button in its header.' },
      ],
    },
    {
      id: 'calendar',
      title: 'Calendar and meetings',
      blocks: [
        { kind: 'p', text: 'A meeting from the portal creates an event in the Bitrix24 calendar and invites the attendees. The portal sees in advance who is busy — which is why it can suggest a time when everyone is free.' },
        { kind: 'p', text: 'In the portal calendar, Bitrix24 events are shown on top of task deadlines: you can see that the working time is already taken.' },
      ],
    },
    {
      id: 'limits',
      title: 'What it does not do',
      blocks: [
        { kind: 'p', text: "The portal does not pull other people's tasks out of Bitrix24, and it does not replace it. Only what you sent yourself is synchronised." },
      ],
    },
  ],
}

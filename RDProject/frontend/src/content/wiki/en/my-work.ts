import type { WikiPage } from '../types'

export const myWorkPage: WikiPage = {
  slug: 'my-work',
  title: 'My tasks, calendar and notifications',
  summary: 'Your personal view: what is assigned to you, what is urgent and what is coming up.',
  group: 'portal',
  appRoute: () => '/my-work',
  sections: [
    {
      id: 'my-tasks',
      title: 'My tasks',
      blocks: [
        { kind: 'p', text: 'The section gathers, from every project you can see, whatever is assigned to you personally, and groups it by project. It is not only tasks: the portal looks for your name in every section where an item has someone responsible.' },
        {
          kind: 'table',
          head: ['What shows up', 'On what basis'],
          rows: [
            ['A work-plan task', 'You are the assignee.'],
            ['A backlog item', 'You are the assignee.'],
            ['A risk', 'You are the risk owner.'],
            ['A decision', 'You are named in "Decided by".'],
            ['An assumption', 'You own the assumption.'],
            ['A communication plan entry', 'You are the person responsible for it.'],
            ['A team or stakeholder row', 'You are part of the project.'],
            ['A meeting', 'You are among the participants.'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'The portal recognises you through the people directory. If the assignee or owner field holds free text — "PM", "IT department", a surname with a typo — the item links to nobody and will not appear here. Such a row looks perfectly normal, so the mistake usually surfaces when the person says they have never seen a single task.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'If the section is empty, nothing has been assigned to you yet. For a portfolio manager that is normal: their cross-project view is called "Portfolio".',
        },
        { kind: 'shot', src: '/wiki-shots/my-work.png', alt: 'The “My tasks” section with the list of what is assigned to me' },
      ],
    },
    {
      id: 'filters',
      title: 'Filters and working through the list',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Search — by title, across all projects at once.',
            'Open / closed / all: by default only unfinished items are shown, so the list does not grow forever.',
            'Active projects only or all of them: completed and cancelled projects are hidden by default.',
            'Type toggles — switch off risks and stakeholders when today is only about tasks.',
            'Projects collapse one at a time, or all at once with "Collapse all".',
          ],
        },
        { kind: 'p', text: 'The project name in the group header is not always a link: the project opens only if you are its manager, a co-manager or the portfolio manager. A team member sees their own items but not the whole project — that is the difference between "the work is on me" and "I run this project".' },
      ],
    },
    {
      id: 'calendar',
      title: 'Calendar',
      blocks: [
        { kind: 'p', text: 'Work dates and meetings on one grid. Views — month, week and day broken down by the hour; the drop-down on the left narrows it to a single project.' },
        { kind: 'p', text: 'From the portal it picks up work-plan tasks and backlog items that are assigned to you and have dates. An item with no dates will not appear here — look for it in "My tasks". Completed and cancelled projects are left out.' },
        { kind: 'p', text: 'Events from your Bitrix24 calendar are laid on top, so you can see which working hours are already taken. If they get in the way and you want the project view alone, clear the "Bitrix events" checkbox — the choice is remembered.' },
      ],
    },
    {
      id: 'attention',
      title: 'Notifications',
      blocks: [
        { kind: 'p', text: 'The bell at the top of the left menu looks wider than "My tasks": it collects what is worth a look across all your unfinished projects, no matter who the work is assigned to.' },
        {
          kind: 'table',
          head: ['Group', 'What lands there'],
          rows: [
            ['Overdue', 'The date has passed and the task is neither completed nor cancelled.'],
            ['Due soon', 'A week or less until the planned end.'],
            ['Stalled', 'The task is in progress, progress is still 0%, and it should have started more than a week ago.'],
            ['Action items', 'An action item from a meeting due within the week or already overdue.'],
            ['Upcoming meetings', 'A meeting within the next seven days.'],
            ['No dates', 'An open task with neither a start nor an end date.'],
          ],
        },
        { kind: 'p', text: 'Clicking a line takes you straight to the right section of the project. The number on the bell is how many are unread; "Mark all as read" clears it until something new arrives. What you have read is remembered in the browser, so the counter may differ on another computer.' },
        { kind: 'note', tone: 'tip', text: 'An empty bell is not necessarily good news. A project with no dates entered has nothing to be overdue: silence here means either everything is in order or the work plan is not filled in.' },
      ],
    },
  ],
}

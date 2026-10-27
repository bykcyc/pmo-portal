import type { WikiPage } from '../types'

export const meetingsPage: WikiPage = {
  slug: 'meetings',
  title: 'Meetings and minutes',
  summary: 'Agenda, decisions and action items — and all of it spreads across the project by itself.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/meetings`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'A meeting with no minutes is forgotten within a week. Here you describe the meeting once — agenda, attendees, decisions, action items — and the portal spreads the result across the project on its own.' },
        { kind: 'p', text: 'The section pays for itself by the third meeting: "what did we decide back then?" stops being a question, and action items no longer have to be dug out of chat threads. Everything else follows from that.' },
      ],
    },
    {
      id: 'fields',
      title: 'What a meeting is made of',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Title and date', 'Required: without them the meeting will not save and no Bitrix event can be created.'],
            ['Type', 'Kick-off, weekly sync, steering committee, review, retrospective, ad hoc.'],
            ['Time and duration', 'Duration defaults to an hour, in steps of 15 minutes. It also defines the window the portal looks for when finding a time.'],
            ['Location', 'A room or a link to the online meeting. It goes into the Bitrix event description as the first line.'],
            ['Agenda', 'Item, presenter and time box. A presenter you pick is added to the attendee list automatically.'],
            ['Attendees', 'Pick from the directory: with no email address the minutes will not reach them, and with no Bitrix link they cannot be invited to the calendar and their busy time is invisible.'],
            ['Minutes', 'The course of the discussion, as free text.'],
            ['Action items and decisions', 'What the meeting produced. On finalizing they move to other sections — see below.'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'The creation form has no fields for action items or decisions — they appear once the meeting is saved. Create the meeting, open it and press "Edit".' },
        { kind: 'p', text: 'The "Attended" checkbox is ticked after the meeting and affects nothing else: calendar invitations go to the whole list.' },
      ],
    },
    {
      id: 'flow',
      title: 'How it works',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Create the meeting', text: 'Topic, date, time, attendees. Better to write the agenda in advance — then people turn up prepared.' },
            { title: 'Create the event in Bitrix24', text: 'The “Create in Bitrix” button puts the meeting into the calendar and invites the attendees. The portal checks up front who is busy.' },
            { title: 'Run it and write it down', text: 'During the meeting, add decisions and action items straight into the meeting card.' },
            { title: 'Finalize the meeting', text: 'This is the key step: on “Finalize”, decisions go to the “Decision log” and action items to the “Action backlog”.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Do not add the same decisions to the log by hand as well: finalizing the meeting moves them for you, and you end up with duplicates.',
        },
      ],
    },
    {
      id: 'finalize',
      title: 'What "Finalize" does',
      blocks: [
        { kind: 'p', text: 'One button does three things: it marks the meeting as final, moves the decisions into the "Decision log" and the action items into the "Action backlog". The portal reports how many of each went across — that line is your confirmation that the move happened.' },
        {
          kind: 'table',
          head: ['Where', 'What appears'],
          rows: [
            ['Decision log', 'An entry with a D-NN code: the decision text, the rationale, the meeting date, status "Active". "Decided by" holds the named person, or the meeting title if none was given.'],
            ['Action backlog', 'An item with a B-NN code: the action text, priority "Medium", status "New". The name of the person the action was given to lands in the "Requested by" column.'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'An action item does not travel in full: the due date is not carried over at all, and the assignee ends up under "Requested by" rather than "Assignee". Until the backlog item has an assignee and dates, it will not show up in anyone\'s "My tasks" and will not reach the calendar. Two minutes right after the meeting, and the action item starts living.',
        },
        { kind: 'p', text: 'Finalizing twice is harmless: the portal marks what it has already moved and does not create it again. A finalized meeting becomes read-only; to add to the minutes press "Undo finalize" — decisions and action items already moved stay where they are, nothing is rolled back.' },
      ],
    },
    {
      id: 'slots',
      title: 'Finding a time',
      blocks: [
        { kind: 'p', text: 'The “Find a time” button looks into the Bitrix24 calendars of every attendee — yours included — and suggests the slots when everyone is free. It searches working hours: weekdays 9 to 18, in half-hour steps, a month ahead; lunch does not count as busy.' },
        { kind: 'p', text: 'The portal offers the eight best options, preferring the nearest days and the morning. If there is no fully free window, instead of an empty list you get compromises labelled "3 of 4 free" — so you can see exactly whom you would be leaving out.' },
        { kind: 'p', text: 'If one of the guests is busy anyway, the portal asks: create the meeting without them (they get no invitation) or pick another time. And if it is your own calendar that is busy, the meeting cannot be created: the organiser cannot be left out of the event.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Busy time is only checked when the meeting has a time filled in. Without one the portal checks nothing and puts the event at 10:00 — on top of someone else\'s meeting if that slot is taken. Anyone with no Bitrix link is out of the search entirely: their busy time is invisible and no invitation reaches them.',
        },
        { kind: 'p', text: 'Other people\'s calendars are shown as intervals only: when someone is busy is visible, what they are busy with is not.' },
        { kind: 'note', tone: 'info', text: 'The organiser of the Bitrix event is whoever pressed the button, not the project manager: the meeting appears in their personal calendar, and deleting it is theirs to do too.' },
      ],
    },
    {
      id: 'recur',
      title: 'Recurring meetings',
      blocks: [
        { kind: 'p', text: 'The "Repeat" button creates between one and twelve new draft meetings: agenda, attendees, type, location, time and duration are copied. Minutes, decisions and action items are not — those belong to each meeting separately.' },
        { kind: 'p', text: '"Monthly" here means "every 30 days", not the same date next month: a series starting 1 June gives 1 July, 31 July, 30 August. For a weekly sync that goes unnoticed; for a "first of the month" meeting it matters.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Copies inherit the "✓ Bitrix" mark from the original even though they have no events of their own. Do not remove the event from a copy with "Remove from Bitrix" — it deletes the original meeting.',
        },
      ],
    },
    {
      id: 'look',
      title: 'How it looks',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/meetings.png', alt: 'The list of project meetings' },
      ],
    },
  ],
}

export const backlogPage: WikiPage = {
  slug: 'backlog',
  title: 'Action backlog',
  summary: 'Ideas, wishes and action items you will get to later.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/backlog`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'Not everything that gets said has to go into the work plan straight away. The backlog is the place where a thought is not lost but is not in the way either.' },
        { kind: 'p', text: 'Action items from finalized meetings land here automatically as well — with their text and priority, but without an assignee or dates. This is where you fill those in.' },
        { kind: 'note', tone: 'tip', text: 'Do not delete rejected items. "We looked at it and decided not to" is a boundary of the project, and six months later it answers "why didn\'t we do this?" better than anyone\'s memory.' },
      ],
    },
    {
      id: 'fields',
      title: 'What an item is made of',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Code', 'B-01, B-02 … Assigned by the portal.'],
            ['Title', 'The request in one line. The only required field.'],
            ['Description', 'Context and acceptance criteria. It travels both into the task on promotion and into the Bitrix24 task.'],
            ['Priority and status', 'Default to "Medium" and "New".'],
            ['Start, Estimate (days), End', 'Three linked fields: fill in two and the portal works out the third. Days are calendar days, inclusive — one day means start equals end.'],
            ['Assignee', 'Pick from the directory. Only then does the item show up in that person\'s "My tasks" and the assignee travel with the task into the work plan.'],
            ['Requested by', 'Who asked: the client, a manager, someone at a meeting.'],
            ['Bitrix24', 'The linked task number. Empty means a "Create" button.'],
          ],
        },
        { kind: 'note', tone: 'tip', text: 'The full description of an item is edited in its card: click the item code (B-01), the pencil next to the title, or the «Description» cell itself. There the fields sit in two columns and the description knows bold, italics and lists. Dates, priority and status are still edited right in the table.' },
        { kind: 'note', tone: 'info', text: 'A B-NN code gets reused: if item B-03 is deleted or promoted, the next one added takes B-03 again. Quoting the code in a message is fine; treating it as a permanent identifier is not.' },
      ],
    },
    {
      id: 'statuses',
      title: 'How an item moves',
      blocks: [
        {
          kind: 'table',
          head: ['Status', 'What it means'],
          rows: [
            ['New', 'The idea or request has been added and not yet triaged.'],
            ['In review', 'Weighing value and effort: do we take it or not.'],
            ['Approved', 'We are doing it. Time to promote it into the work plan.'],
            ['Rejected', 'Reviewed and not going to happen. It stays on the list as a deliberate boundary of the project.'],
            ['Promoted', 'A task has already been made from it.'],
          ],
        },
        { kind: 'p', text: 'The "On this page" panel watches exactly three things: how many approved items are waiting to be promoted, how many critical ones are still untriaged, and how many new ones have sat still for more than two weeks. An empty backlog draws no complaints from it.' },
      ],
    },
    {
      id: 'promote',
      title: 'Promoting to the work plan',
      blocks: [
        { kind: 'p', text: 'When the turn of an item comes, the arrow in its row turns it into a real work-plan task. Title, description, priority and planned dates travel with it. So does the assignee — but only if they were picked from the directory: a name typed as text is not inherited.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'The task lands at the root of the work plan, outside any phase, with status "Not started". Drag it into the right phase straight away — otherwise it stays as a separate row at the bottom and belongs to no phase, neither on the Gantt chart nor in reports.',
        },
        { kind: 'p', text: 'The linked Bitrix24 task moves along with the item: the number is kept, so there is no need to create it a second time. What does not travel: the estimate in days (tasks count hours), "Requested by" and the B-NN code. The backlog row itself disappears after promotion — the task now lives in the work plan.' },
      ],
    },
    {
      id: 'bitrix',
      title: 'A task in Bitrix24',
      blocks: [
        { kind: 'p', text: 'An item can be turned into a Bitrix24 task without entering it into the work plan — handy for small errands. The Bitrix title gets the project code as a prefix, the project manager becomes the creator, the chosen person the assignee, and the item\'s planned end date becomes the deadline.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'If "No such person in Bitrix" is showing next to the assignee, the task is still created — and goes to the default assignee rather than the person you picked. Check that warning before pressing "Create".',
        },
        { kind: 'p', text: 'Only the status comes back from Bitrix: when the assignee closes the task, the backlog item becomes done by itself. The "Sync" button in the project header does not cover the backlog — it refreshes work-plan tasks.' },
      ],
    },
  ],
}

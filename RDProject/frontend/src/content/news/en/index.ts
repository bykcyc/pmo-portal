import type { NewsItem } from '../types'

/** The Russian set defines the order and the list of entries (see content/news/ru). */
export const NEWS: NewsItem[] = [
  {
    id: '2026-10-28-access-hardening',
    date: '2026-10-28',
    title: 'Changing your password now disconnects the assistant too',
    summary: 'After a password change, connect the assistant again. The creator of a Bitrix24 task is always the project manager. An employee who has left in Bitrix24 loses portal sign-in automatically.',
    blocks: [
      { kind: 'p', text: 'Three changes about access. Each one closes a case where the portal treated access as closed while it stayed open — or where a task reached people from someone who never set it.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'A new password means a new assistant connection',
            text: 'People change their password when they fear it has leaked. Until now a password change ended browser sessions, but the assistant connection (Claude, ChatGPT) kept working for up to 90 days. Now it is revoked too. After changing your password, connect the assistant again: the connector in Claude or ChatGPT will ask you to confirm access once more, and a manual token can be issued in “Profile → Assistant connection”. The same happens when the portfolio manager changes your password.',
          },
          {
            title: 'The Bitrix24 creator is the project manager',
            text: 'In the “Create task in Bitrix24” window the “Creator” field can no longer be chosen. It is the project manager, or you if they are not in Bitrix24. Before, any employee could be picked there, and the task reached people “from” someone who never set it.',
          },
          {
            title: 'People who leave lose sign-in automatically',
            text: 'When an employee is deactivated in Bitrix24, the nightly people sync also turns off their portal sign-in and assistant connections. In “Settings → Users” such an account is marked “Left (Bitrix24)”. If access is still needed (a contractor, a mistake in Bitrix24), the portfolio manager ticks “Active” — and the sync leaves that account alone from then on.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'The sync does not apply more than three “departures” in one night: that looks like a broken export from Bitrix24, not people leaving. In that case nobody is switched off, and an entry appears in the Bitrix24 sync log. The sync never switches off the last active portfolio manager.',
      },
    ],
  },
  {
    id: '2026-10-28-assistant-sees-whole-project',
    date: '2026-10-28',
    title: 'The assistant sees an opened project in full — the help now says so plainly',
    summary: 'The "Open the project to the assistant" checkbox opens the whole project, budget, decisions and stakeholder assessments included. The help promised a second checkbox that keeps money and people assessments in the portal — there is none, and the text is fixed.',
    blocks: [
      { kind: 'p', text: 'The help page "Connecting an assistant" said that a separate checkbox keeps the assistant away from the budget and stakeholder assessments. There is no such checkbox: "Open the project to the assistant" opens the project as a whole, and everything the assistant reads from it goes to the service you use. Only the contents of attached files stay behind — the assistant sees just a list of them. The help now describes this as it is.' },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Check which projects are open: "Share" in the project header → the "Assistant (MCP)" tab. Keep open only those whose data your organisation’s policy allows you to share with the AI service you use. Unticking the checkbox closes access at once.',
      },
    ],
  },
  {
    id: '2026-09-30-honest-rag',
    date: '2026-09-30',
    title: 'Project colour has become more honest',
    summary: 'Red means a quarter of the plan is overdue or there is a high risk with no mitigation plan. An honestly logged risk with a plan no longer turns a project red.',
    blocks: [
      { kind: 'p', text: 'Until now a project turned red from a single overdue task or a single high risk. A colour like that stops meaning anything: when everything is red, you cannot see where something is really on fire.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Red — time to step in',
            text: 'At least a quarter of the work and at least three items are overdue. Or there is an open high risk that nobody has written a mitigation plan for.',
          },
          {
            title: 'Amber — worth a closer look',
            text: 'At least one item is overdue, at least one high risk is open, or a medium risk is open.',
          },
          {
            title: 'A risk with a plan is management, not an alarm',
            text: 'If you have logged a high risk and written down what you will do about it, the project no longer turns red because of it. To clear the red, it is enough to fill in the risk\'s «Mitigation plan» field.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Phases are not counted, and cancelled tasks are not treated as overdue. Earlier portfolio snapshots were not recalculated — history stays as it was. Details and thresholds are in the help, page «How portfolio figures are calculated».',
      },
    ],
  },
  {
    id: '2026-09-16-full-text-on-hover',
    date: '2026-09-16',
    title: 'Long text in tables reads in full — hover over the cell',
    summary: 'When an entry does not fit its column, hovering opens a window with the full text. You can still click and edit the cell as before — the window does not catch the mouse.',
    blocks: [
      { kind: 'p', text: 'In the sections where a row has no card of its own — stakeholders, team, assumptions, communication plan, decisions, KPIs, risks — text is cut to two lines. There was nowhere to read a long note: widen one column and the neighbours shrink.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Hover and see everything',
            text: 'The window appears after about a third of a second, and only where the text is ACTUALLY cut off. If the entry fits, nothing pops up — the table does not flicker while you simply move the mouse across it.',
          },
          {
            title: 'It does not get in the way of editing',
            text: 'The window does not catch the mouse: a click goes straight through it into the cell and opens it for editing, as before. That was the main requirement — no “I hovered and now I cannot edit”.',
          },
          {
            title: 'From the keyboard too',
            text: 'Tab onto a cell and the window opens at once, with no delay. Escape closes it. On a tablet, where there is no hovering, the window stays out of the way.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'You can still drag column widths, and the window takes that into account: it looks at the current width at the moment you hover, not at the one the page loaded with.',
      },
    ],
  },
  {
    id: '2026-09-16-transfer-by-pm',
    date: '2026-09-16',
    title: 'A project manager can now hand a project over themselves',
    summary: 'The “Hand over” button in the project header is now available to the project manager, for their own projects. Whoever hands a project over stays on as a co-manager and keeps access.',
    blocks: [
      { kind: 'p', text: 'Handing a project to someone else used to be the portfolio manager\'s job, and every handover went through them. Now the person running a project can pass it on themselves.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Where the button is',
            text: 'In the project header, in the same row as “Action log” and “Share” — “Hand over”, with the arrows icon. It is not inside “More”. You see it on your own projects: the ones where you are the manager.',
          },
          {
            title: 'You stay on as a co-manager',
            text: 'The project moves to the person you pick: they become its owner and see it among their projects. Your access stays — the portal adds you as a co-manager, so handing over does not mean losing the project. The handover window says so too.',
          },
          {
            title: 'Who is in the list',
            text: 'Only people who have a portal account and may run projects. Previously the list could include someone from the people directory with no account — and the handover failed.',
          },
          {
            title: 'The passport works the same way',
            text: 'The “Project manager” field can be changed in the passport again: on your own project by you, on any project by the portfolio manager.',
          },
          {
            title: 'When you create a project, you are its manager',
            text: 'The “Project manager” field in a new passport is now read-only — and that is a fix. You used to be able to type a colleague there, but the project was recorded against whoever created it, with no warning at all. Hand the project over right after creating it, with the button in the header.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'A co-manager cannot hand the project over: otherwise they could make themselves the lead and lock out the real manager. Handing over is for the person who owns the project and for the portfolio manager.',
      },
    ],
  },
  {
    id: '2026-09-16-cards-keep-your-work',
    date: '2026-09-16',
    title: 'The card no longer throws away what you typed',
    summary: 'Close a task, backlog item or risk card and it saves instead of losing your text. Selecting text with the mouse no longer slams it shut. Promoting an item to the work plan keeps the link to its Bitrix24 task.',
    blocks: [
      { kind: 'p', text: 'People spend minutes writing a description or a plan in a card, yet it only reached the server through the "Save" button. Anything typed around that button was lost silently — and usually not because of a mistake.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Closing means saving',
            text: 'The cross, Escape and a click on the dimmed area behind the card now save what you typed first and close afterwards. If the server refuses the change, the card stays open — your text is in front of you, not gone. Press close again to leave without saving.',
          },
          {
            title: 'Selecting text with the mouse no longer slams the card shut',
            text: 'The most galling loss: you selected a long description, released the button just outside the panel — and the card closed together with the text. That is how the browser works: it hands the click to the common place of where the gesture started and ended, and that was the dimmed area. Now only a press that starts on the dimmed area itself closes the card.',
          },
          {
            title: 'Escape in "+ Add a person" cancels only the adding',
            text: 'Previously, if you changed your mind about creating a new person and pressed Escape, the whole card closed — together with everything unsaved.',
          },
          {
            title: 'Promoting an item keeps its Bitrix24 task',
            text: 'If a Bitrix24 task had already been created from a backlog item, its number now travels into the work-plan task. The link used to be lost, so the portal offered to create the task again — and the assignee got a second identical one in Bitrix.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Only the fields you actually touched are sent. The card does not write the rest — while it is open, the task status may have been changed by the Bitrix24 sync or by a colleague.',
      },
    ],
  },
  {
    id: '2026-09-16-formatted-descriptions',
    date: '2026-09-16',
    title: 'A formatted description shows at once, and the assistant knows how to format one',
    summary: 'A description with bold and lists opens already formatted, without asterisks. In the work plan it no longer collapses from a stray click. The assistant has been told what it may format with, and where it may not.',
    blocks: [
      { kind: 'p', text: 'We introduced formatting in descriptions a week ago, but only the people who pressed «Preview» ever saw it. That is what we fixed.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'The description opens formatted',
            text: 'If the text has bold, lists or a subheading, you see them as they are straight away, not as «**important**». Need to change something — the «Edit» button is right there. An empty description, and text without any formatting, still open for editing: there is nothing to look at.',
          },
          {
            title: 'A reader is no longer shown an input field',
            text: 'Anyone with view-only access sees the finished text rather than a locked field full of formatting marks.',
          },
          {
            title: 'The work plan stopped damaging long descriptions',
            text: 'This was the same silent loss we closed in the backlog last time: the description was edited in the table by a single-line field, and such a field strips line breaks by the way browsers work. Clicking into the cell and clicking away was enough to collapse several paragraphs into one line. A click on the description now opens the task card.',
          },
          {
            title: 'The assistant knows what to format with',
            text: 'The external assistant has been given the rules: the portal\'s six marks, not the whole of markdown. It will no longer bring links, tables, struck-through text or deeper headings — and if it does, the portal warns it before you ever see the draft. It also knows formatting belongs only in a task description and a backlog item description: on a risk, a decision or a meeting record the marks would stay on screen for good.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'In tables, exports and Bitrix the description still shows without the formatting marks — there is no room for them there. The full formatted text lives in the card.',
      },
    ],
  },
  {
    id: '2026-09-16-backlog-card',
    date: '2026-09-16',
    title: 'A backlog item now has a card, just like a task',
    summary: 'The item code opens a window with the fields in two columns and the description on its own tab. In the table, a single-line field no longer damages the description.',
    blocks: [
      { kind: 'p', text: 'The backlog was the one section where long text had to be typed into a cell the width of a finger. The item now has a card — the same one a task has in the work plan.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Three ways in',
            text: 'Click the item code (B-01, B-02…) — it is a button now. Or the pencil that appears next to the title on hover. Or the «Description» cell itself — the card opens straight on that tab.',
          },
          {
            title: 'The description no longer loses paragraphs',
            text: 'This was a silent loss: in the table the description was edited in a single-line field, and such a field strips line breaks by the way browsers work. Clicking into the cell and clicking away was enough for text from a meeting record to collapse into one line. The description is now edited only in the card, at the full size of the window, and it knows bold, italics and lists. In the table it shows short and without the formatting marks.',
          },
          {
            title: 'Dates are worked out the same way',
            text: 'Start, «days» and end in the card are tied by the same arithmetic as in the table: from the start date either the end or the duration is worked out. The same input gives the same result wherever you type it.',
          },
          {
            title: 'The assignee is finally kept whole',
            text: 'Picking a person from the directory went to the server twice, and the second call erased the link to their record, leaving only a name. That is why «Promote to the work plan» quietly lost the assignee. Fixed both in the card and in the table.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'The card opens in read-only mode too: an observer previously could not see an item\'s details at all. Promoting to the work plan, deleting, and creating a Bitrix24 task stay in the table row.',
      },
    ],
  },
  {
    id: '2026-09-15-assistant-dates',
    date: '2026-09-15',
    title: 'The assistant no longer knocks neighbouring dates about, and it can remove links',
    summary: 'The dates the assistant proposed stay the way you accepted them. Removing a link finally works, and tasks moved along the chain are listed in the report.',
    blocks: [
      { kind: 'p', text: 'Three faults found during a large plan transfer, all of them about the project ending up different from the draft after Accept.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Draft dates are no longer overwritten',
            text: 'When a task\'s dates change, the portal moves its successors by the same amount — that is auto-scheduling, and it is usually right. But when the assistant set dates for dozens of tasks at once, the shift from one landed on top of a date the same draft had explicitly set for another. In a large transfer a noticeable share of tasks could come out that way, some even past the end of the project. The rule is now simple: what the draft states explicitly, the cascade leaves alone.',
          },
          {
            title: 'What moved with it is listed',
            text: 'The application report has a new section, «Moved along the links»: tasks the draft never named whose dates followed their predecessors — with the new dates. Previously the only way to learn about it was to compare the work plan row by row.',
          },
          {
            title: 'Links can be removed',
            text: 'The assistant would propose «remove the dependency», the portal would answer «accepted» — and the link stayed. It is removed now. This also makes it possible to reverse a link in a single draft: the server removes old links before it adds new ones, otherwise the new one was rejected as a loop.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'The application report opens from the draft link in the «Assistant» menu — everything deleted is named there too.',
      },
    ],
  },
  {
    id: '2026-09-15-task-card',
    date: '2026-09-15',
    title: 'The task card is wider, and the description has its own tab and formatting',
    summary: 'The task window grew, the fields moved into two columns, and the description got its own tab with bold, italics and lists.',
    blocks: [
      { kind: 'p', text: 'The task card is the screen people open most, and almost nothing fitted in it. Now it does.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'A bigger window, fields in two columns',
            text: 'It used to be 672 pixels and a single column: half the form fell below the edge and the Save button had to be found by scrolling. It is now 1024 and two columns — the whole form fits on a laptop screen.',
          },
          {
            title: 'The description has its own tab',
            text: 'It used to be the second-to-last field, four lines tall, so a long text was read through a slot. It now has a tab the full size of the window.',
          },
          {
            title: 'Formatting',
            text: 'Buttons above the field: bold, italic, monospace, subheading, bullet list and numbered list. Next to them a «Preview» to see how it will look. It works from the keyboard too: **bold**, *italic*, «- » at the start of a line for a list.',
          },
          {
            title: 'Line breaks are finally kept',
            text: 'That was the real loss: paragraphs in a description collapsed into one line. The text now looks the way it was typed.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'In the work-plan table the description still shows short and without the formatting marks — there is no room for them there. The full text lives in the card. Bitrix receives the description without the marks: it has its own markup.',
      },
    ],
  },
  {
    id: '2026-09-15-tabs-nav-colors',
    date: '2026-09-15',
    title: 'A new tab no longer asks you to sign in, and the menu and work plan read better',
    summary: 'The portal opens in any tab without signing in again. Clicking a category opens its first section, the menu items slide in, and priorities are legible in the dark theme.',
    blocks: [
      { kind: 'p', text: 'Four fixes from your notes — all of them things that got in the way daily.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'The sign-in is remembered for the whole browser',
            text: 'A link from a chat, a bookmark, a new window, a tab restored after a browser restart — the portal no longer asks for the password again. Every such tab used to be a separate session, and with two-factor on that meant a code as well; a few attempts in a row then ran into the brute-force guard. The session still lasts 8 hours, and signing out in one tab now signs you out everywhere.',
          },
          {
            title: 'A category opens its own section',
            text: 'Clicking «Planning» or «Control» now opens the first section of that category. It used to change only the row of items while the page stayed put, which looked like the button had not worked. If you are already inside the category, nothing moves.',
          },
          {
            title: 'You can see the items change',
            text: 'Switching categories makes the menu items slide in briefly. If your system is set to reduce motion, there is no animation.',
          },
          {
            title: 'Colours in the work plan',
            text: 'In the dark theme priorities and statuses got their own shades: «Critical» no longer sinks into the background. A phase row now differs in tone from the tasks under it, so blocks of work read at a glance. Cancelled tasks turned grey: they are not bad, they are withdrawn.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'On a shared computer, remember to use «Sign out» — the session now survives closing the browser.',
      },
    ],
  },
  {
    id: '2026-09-14-milestones-from-plan',
    date: '2026-09-14',
    title: 'Passport milestones come from the work plan and get ticked off',
    summary: 'The «Key milestones» block shows the phases of the work plan, or its tasks when there are no phases. Finished ones are ticked.',
    blocks: [
      { kind: 'p', text: 'This block used to show three different things, and nobody could tell where they came from. There is now one rule for every project.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'One rule',
            text: 'If the work plan has phases, the milestones are those phases. If it has none, they are the top-level tasks. Subtasks are not shown: they are the detail of the work, not points to report on. The list typed into the passport as text is gone — it drifted from the plan: on one project the same milestone sat at 1 July in the text and at 30 September in the task.',
          },
          {
            title: 'The tick follows the status',
            text: 'Set a task to «Done» in the work plan and it is ticked in the passport too. The percentage complete plays no part: a half-finished milestone has not happened. Project progress in the Portfolio counts the same way — one rule now, not two.',
          },
          {
            title: 'A phase closes itself',
            text: 'A phase is ticked once every task inside it is closed, even if the phase row itself was never closed. Cancelled tasks do not block that, and cancelled milestones are marked «Cancelled» so nobody reads them as finished.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'An empty block means the work plan is still empty. Add phases or tasks: the passport shows the plan, not a separate list.',
      },
    ],
  },
  {
    id: '2026-09-12-tree-polish',
    date: '2026-09-12',
    title: 'A programme and its modules: finishing the project tree',
    summary: 'In the Portfolio subprojects now sit under their umbrella, the Subprojects tab gained the breakdown and a «Create a subproject» button, and the warnings stopped scaring people for nothing.',
    blocks: [
      { kind: 'p', text: 'The project-inside-a-project link worked, but the edges were rough. Here is everything that was left unfinished.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'The Portfolio shows the tree',
            text: 'Subprojects sit under their umbrella, indented and marked with «↳», and the umbrella carries an «Umbrella · N» tag. When some of its modules are red, their count shows next to it: a programme of many modules is no longer scattered through the list among unrelated projects. Sorting by a column works as before — but within a level.',
          },
          {
            title: 'The Subprojects tab expands',
            text: 'A module row now expands into the same «What is wrong» breakdown as the Portfolio: overdue work, risks, overspend and what needs attention this week. The tab used to show numbers only, so «why is this module red» meant opening the project. The same tab has a «Create a subproject» button — the new project is linked to the umbrella right away.',
          },
          {
            title: 'Warnings tell the truth',
            text: 'Archiving an umbrella now says plainly that its subprojects are not affected, and deleting it says they will not be deleted but become standalone projects. Turning an umbrella or a subproject into a template is refused: a template hides from the lists, and the programme would vanish along with its living modules.',
          },
          {
            title: 'The tab stays out of the way',
            text: 'On an ordinary project with no subprojects and nobody to link them, the Subprojects tab is no longer shown.',
          },
          {
            title: 'Company management can edit its own projects',
            text: 'For the «company management» role, its own project opened read-only: the buttons were disabled although the server allowed writing. The screen now matches the rights.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'The date filters in the Backlog moved to the portal’s shared date field — the «dd.mm.yyyy» format is now the same everywhere, whatever the browser language.',
      },
    ],
  },
  {
    id: '2026-09-11-personal-bell',
    date: '2026-09-11',
    title: 'The bell is personal now',
    summary: 'Notifications cover the projects you lead and everything assigned to you. Other people’s work no longer drips in.',
    blocks: [
      { kind: 'p', text: 'The notification scope matched the right to read. For a project manager those are the same thing, but the portfolio owner and company management — who see every project — got a notification for every task in every project: their own were impossible to find among hundreds. An observer likewise got notified about a project they merely watch.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'You lead a project — its bell is yours',
            text: 'A project manager and co-manager still see everything: overdue work, tasks with no dates, stalled work, upcoming meetings and action items. An umbrella manager sees their subprojects too — the same link through the tree.',
          },
          {
            title: 'You do not lead it — only what is yours',
            text: 'In someone else’s project you will see a task assigned to you (including as a co-assignee), a meeting you attend and an action item recorded against your name. The rest is not your concern.',
          },
          {
            title: 'The cross-project view has not gone anywhere',
            text: 'It is called the Portfolio: every project at once, with the reds and the ambers. The bell answers a different question — «what is needed from ME» — and a list of other people’s work is no answer to it.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Access requests reach whoever leads the project; the answer to your own request and the «problem resolved» message reach you. That has not changed.',
      },
    ],
  },
  {
    id: '2026-09-11-co-assignees-kpi',
    date: '2026-09-11',
    title: 'Co-assignees on tasks and a target value for metrics',
    summary: 'A task now carries a list of co-assignees and shows up in their My tasks. And a metric now shows its target, its actual value and the unit.',
    blocks: [
      { kind: 'p', text: 'Both came from your requests through «Report a problem».' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Co-assignees',
            text: 'The work plan gained a «Co-assignees» column: click it on a task and add people from the directory. The task then appears in their My tasks, labelled with what kind of item it is.',
          },
          {
            title: 'Why not «several assignees»',
            text: 'ONE person still owns the task — the «Assignee» column. When several people are accountable, in practice nobody is, and there is no one to ask. Co-assignees are the people who work on it. They do not pick up workload in the Portfolio: otherwise the same hours would be counted for everyone at once and half the company would show as overloaded.',
          },
          {
            title: 'Target and actual on a metric',
            text: 'The «Success metrics» section gained «Target», «Actual» and «Unit» columns. The portal already stored them — the Excel import and the assistant fill them in — but never showed them, so a metric status had to be set by eye. Now you can see where you are heading and where you are.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'If someone is not in the directory you can type their name as free text — but the portal marks it and cannot show the task to such a «co-assignee», because it does not know who that is. Better to add the person to the People directory first.',
      },
    ],
  },
  {
    id: '2026-09-11-user-reports',
    date: '2026-09-11',
    title: 'Fixed from your reports',
    summary: 'Phase dates, the Clear button in the date picker, row order, risk fields, the date format in the wizard. And the portal now answers back: about a decision on your access request and about your report being resolved.',
    blocks: [
      { kind: 'p', text: 'All of this came in through «Report a problem» or in chat. Thank you — half of it could not have been found without your reports.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Phases would not take dates',
            text: 'In the work plan you could type «Start» and «End» on a phase, but the field stayed empty — the server silently dropped phase dates. Tasks never had this problem. A phase now keeps its own planned dates; its progress is still worked out from the tasks inside it.',
          },
          {
            title: 'The Clear button in the date picker',
            text: 'The picker in the work plan opened empty and on the current month even when the cell already had a date — so Clear did nothing and the month arrows behaved oddly. It now opens on the right month, clearing works, and the date you pick is saved when you leave the field.',
          },
          {
            title: 'Rows could not be moved up or down',
            text: 'One click on a column heading turned sorting on and turned manual ordering off FOREVER: there was no third state, and the choice survived between sessions. A third click now removes the sorting and brings dragging back. This applies to every table, not just the communication plan.',
          },
          {
            title: 'Risk fields before the row is saved',
            text: 'In a new row of the risk register, «Description», «Mitigation plan» and «Contingency plan» were empty cells — they could only be filled in after saving. They are available straight away now.',
          },
          {
            title: 'Date format in the project wizard',
            text: 'In quick project creation the dates were drawn by the browser and looked like MM/DD/YYYY for some people, while the rest of the portal uses dd.mm.yyyy. The field there is now the same as everywhere else. The first day of the week inside the picker is still up to the browser — that is separate work.',
          },
          {
            title: 'The portal started answering',
            text: 'An access request no longer goes into silence: approved or rejected, you will see it in your notifications along with who decided. And when we fix something you reported through «Report a problem», you get a «problem resolved» notification with a short note on what was done.',
          },
          {
            title: 'Who receives an access request',
            text: 'The request is seen by the project manager and the co-managers — the people who run that project. The portfolio owner no longer receives them for every other project (they can still decide if asked). And the request itself does not expire: it waits for a decision as long as needed, while two months is the pause after a refusal, not the lifetime of the request.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'If your milestones were typed into the passport by hand and there are no phases in the work plan yet, the «Key milestones» section shows them again. It used to say «empty» even though the data was never lost.',
      },
    ],
  },
  {
    id: '2026-09-11-tidy-up',
    date: '2026-09-11',
    title: 'My tasks reads clearly and the budget shows more',
    summary: 'My tasks now says what each row is and whose project it belongs to. The Portfolio shows how much of a parent budget went through subprojects. The budget export gained hours.',
    blocks: [
      { kind: 'p', text: 'A batch of small fixes following feedback: each one is minor, but together they are about the same thing — making the screen say what it means.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'My tasks: you can see what a row is',
            text: 'Every row now names its type: «Task», «Risk», «Decision», «Stakeholder». There used to be only a coloured icon, so a stakeholder row read as somebody name and a picture — there was no way to tell what kind of item it was. The columns line up too: a long project code no longer shifts the names on neighbouring rows, and the manager name sits right after the project name instead of at the far right.',
          },
          {
            title: 'Portfolio: what went through subprojects',
            text: 'A parent project row now carries a «via subprojects (N): amount» line under its actuals — how much of its blocks the modules have spent. The number is not part of any portfolio total: otherwise a module money would be counted twice, once for itself and once for the programme.',
          },
          {
            title: 'Budget: hours in the export and a hint',
            text: 'When a project has an hourly rate, the Excel export gains an «Hours (plan)» column and an «Hours (actual)» row per month — you can see what the amount is made of when you check it against the contractor invoice. And an empty money cell in the monthly plan shows in grey what the hours you already entered would come to.',
          },
          {
            title: 'Filters and column settings',
            text: 'The backlog date filters are gathered into two clear frames, «Start» and «End», instead of four loose fields. The column-settings button moved to the right edge on every page — it is not part of the section heading. The news page and the help section are now centred on screen.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-09-11-consolidated-budget',
    date: '2026-09-11',
    title: 'Consolidated budget: hours, rate and what is left in each block',
    summary: 'A parent project now budgets in blocks: hours × rate for the plan, spending pulled from its subprojects, and the remainder of every block in one table.',
    blocks: [
      { kind: 'p', text: 'When the contractor reports in hours per block («40 hours on block X in a month») and different people run the blocks, the remainder of a block had to be assembled by hand from many tabs. By the time it was assembled the numbers were stale. The portal now works it out itself.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Hourly rate',
            text: 'The «Budget» section of a parent project now has an «Hourly rate» row. Subprojects inherit it — they can see it but not change it. A budget item has an «Hours (plan)» field: enter 800 hours at a rate of 50 and the portal fills in 40,000. Type an amount by hand and your amount wins over the calculation.',
          },
          {
            title: 'Actuals in hours',
            text: 'With a rate set, the monthly plan gains a third row — «Hours (actual)». Enter 120 hours for August and the portal works out 6,000. One property matters: hours turn into money at the moment you enter them. Raise the rate in July and January stays priced at the January rate, so status reports never drift away from the budget.',
          },
          {
            title: 'Attributing spending to a block',
            text: 'The budget of a subproject gains an «Attribute spending to the parent project blocks» panel: for each of your items you pick the block it belongs to and immediately see what is left in it. Your amounts stay yours — on its own screen the subproject still sees its full plan and actuals.',
          },
          {
            title: 'The picture for the parent project',
            text: 'The budget of the parent project gains a «Split across subprojects» table: per block, the plan, its own actuals, how much each subproject took, the total spent and the remainder. A negative remainder is highlighted in red — that is the signal to take to the contractor.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Nothing disappears quietly. Subproject spending outside the blocks is listed on its own line, and if a block is deleted in the parent project the spending attributed to it does not vanish — the portal shows it as a warning and asks you to re-attribute it. The portal does not add up different currencies across the tree: it cannot convert, so it says so plainly.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'A fix landed alongside: the «Budget: cumulative by month» chart counted January 2026 and January 2027 as one point — the year in the record was never read at all. On projects longer than a year the chart showed half the points it should have, and those points were sums of different years.',
      },
    ],
  },
  {
    id: '2026-09-10-backlog-filters',
    date: '2026-09-10',
    title: 'Backlog: date filters and working statuses',
    summary: 'The backlog now filters by start and end dates, and the statuses gained «In planning», «In progress» and «Done».',
    blocks: [
      { kind: 'p', text: 'The backlog kept growing while there was almost nothing to narrow it with: one status filter, and even that showed only half of the values. There are more filters now, and a single status list for the whole section.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Filtering by dates',
            text: 'Two pairs of fields sit above the table: «Start: from — to» and «End: from — to». The bounds are inclusive and set independently, so you can ask «what starts in March» or «what has to finish before April». A «Reset» link appears next to them, and the counter shows two numbers — how many are visible out of how many.',
          },
          {
            title: 'New statuses',
            text: '«In planning», «In progress» and «Done» join «New», «In review» and «Approved» — an item can be run in the backlog itself, without moving it into the work plan. The list is now ordered by the course of work instead of being mixed up.',
          },
          {
            title: 'One status list instead of two',
            text: 'You could previously SET «In progress» in a table cell, but neither pick it when adding a row nor find it with the filter: the list of values lived in two places and drifted apart. It is one list now, and every status is available everywhere alike.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'An item with no date does not fall inside the range you set: if you asked «what starts in March», a row without a start date does not answer that question. That is why the counter shows «how many out of how many» — the rows have not disappeared, they are simply outside the range.',
      },
    ],
  },
  {
    id: '2026-09-10-access-requests',
    date: '2026-09-10',
    title: 'Request project access straight from My tasks',
    summary: 'You can see who the project manager is and ask them for read access. The request lands in their notifications, where one button settles it.',
    blocks: [
      { kind: 'p', text: 'My tasks collects your items from every project — including the ones where you are only a participant and cannot go inside. Until now all you saw there was a padlock: the portal never said whose project it was or who to ask, so you went looking for the manager in chat.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'You can see the manager',
            text: 'Next to a closed project the portal now shows its manager — the person who decides whether to let you in.',
          },
          {
            title: 'Ask for access',
            text: 'The «Request access» button sits right there. You can briefly say why you need it: without a reason the manager has nothing to decide on. Access is requested for viewing — as an observer, you will not be able to edit anything.',
          },
          {
            title: 'The manager decides in notifications',
            text: 'The request reaches the project manager in the bell and in the «Needs attention» block on the Portfolio. Clicking it opens a form: who is asking, for which project, what they get and why — with two buttons, «Approve» and «Reject». Approving adds the person as an observer immediately.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'While the request is waiting, the button turns into a «Request sent» marker — there is no need to ask twice. If it is rejected, you can ask again in 24 hours. Requests are decided by the project manager and the portfolio owner; co-managers cannot, the same way they cannot grant observers by hand.',
      },
    ],
  },
  {
    id: '2026-09-10-subprojects',
    date: '2026-09-10',
    title: 'A project inside a project',
    summary: 'A large project can be assembled from subprojects. The manager of the overall project sees and runs every module, and the module managers see each other.',
    blocks: [
      { kind: 'p', text: 'When an implementation consists of many modules, each with its own manager, nobody had the overall picture: everyone saw only their own piece. Projects can now be linked.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'How to link',
            text: 'Open the overall project → the “More” button → “Subprojects” → pick an existing project. Linking is done by the manager of the overall project, provided they also run the project being attached, and by the portfolio owner. There is only one level: a subproject cannot have subprojects of its own.',
          },
          {
            title: 'Who sees what',
            text: 'The manager of the overall project and their co-managers get full access to every subproject — they see and edit. Subproject managers see the overall project and the neighbouring subprojects, but view-only. In the project list, subprojects sit under their overall project, and the “My role” column explains why you can see a given project.',
          },
          {
            title: 'The overall picture',
            text: 'The overall project now has a “Subprojects” section: progress, overdue work, high risks and budget of every module in one table, with totals on top. The numbers are computed by the same code as in the Portfolio, so the two will not disagree.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Tree permissions appear and disappear the moment you link or unlink — there is nothing to wait for. Deleting the overall project does not delete its subprojects: they simply become standalone.',
      },
    ],
  },
  {
    id: '2026-09-09-meetings-bitrix-honest',
    date: '2026-09-09',
    title: 'Meetings and the Bitrix calendar no longer drift apart',
    summary: 'An event deleted in Bitrix no longer lingers in the portal as a mark. Deleting a protocol removes the event too.',
    blocks: [
      { kind: 'p', text: 'A protocol in the portal and an event in the Bitrix calendar each lived their own life: you could create the link, but after that the portal knew nothing about the event. Fixed in both directions.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Sync notices deleted events',
            text: 'The “Sync” button used to refresh task statuses only. Now it also asks the Bitrix calendar about your meetings’ events: if an event was deleted there, the portal clears the “in Bitrix” mark itself and says so in the message.',
          },
          {
            title: 'The mark can be cleared even when Bitrix is silent',
            text: 'Previously, for a meeting whose event had been deleted in Bitrix, “Remove from Bitrix” answered with an error — leaving no way to clear the mark, while the create button underneath stays hidden. Now the portal asks Bitrix again, and if it is unreachable, offers to clear the mark on our side only, saying plainly that the calendar event, if it still exists, will remain.',
          },
          {
            title: 'Deleting a protocol removes the event',
            text: 'Delete a meeting in the portal and its Bitrix calendar event goes with it. It used to stay there forever, with nothing left to find it by.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'The event is deleted in the calendar of whoever created it, not whoever pressed the button. A project co-manager used to be refused when trying to remove someone else’s event.',
      },
    ],
  },
  {
    id: '2026-09-04-observer-and-pm-portfolio',
    date: '2026-09-04',
    title: 'Project observers and a portfolio for every project manager',
    summary: 'You can now give someone view-only access to a project. And every project manager has their own portfolio.',
    blocks: [
      { kind: 'p', text: 'Two changes, both about who sees what in a project.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Project observer',
            text: 'Next to the “Co-manager” button there is now an “Observer” button. An observer sees the whole project — passport, work plan, risks, budget, meetings — but cannot change anything. The project appears in their project list with the role marked. Observers are added and removed by the project manager and the portfolio owner.',
          },
          {
            title: 'A portfolio for every project manager',
            text: 'The Portfolio section is now open to all project managers. It looks the same as it does for the portfolio owner, but shows only the projects where you are the manager, a co-manager or an observer. Projects where you are merely a participant do not appear.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'An observer is a way to show a project to a neighbouring department or a manager without handing out edit rights. Until now the choice was between a co-manager with full access and nothing at all.',
      },
      {
        kind: 'p',
        text: 'Every future change to the portal will show up here in News — with a date and a plain explanation of what you can now do. While an entry is unread, the menu item carries a dot.',
      },
    ],
  },
]

import type { WikiPage } from '../types'

export const assistantPage: WikiPage = {
  slug: 'assistant',
  title: 'Connecting an assistant',
  summary: 'Run a project from your own Claude or ChatGPT: connecting, the project lock, drafts.',
  group: 'portal',
  appRoute: () => '/profile',
  sections: [
    {
      id: 'what',
      title: 'What this is',
      blocks: [
        { kind: 'p', text: 'The portal can connect to an AI assistant — Claude, ChatGPT or any other client that supports MCP. Once connected, the assistant sees your projects right there in the conversation: you can ask "what is urgent this week", hand it a meeting transcript and ask it to lay the content out across the portal sections.' },
        { kind: 'p', text: 'The point is not to start from an empty passport and sixteen tabs. You already have the raw material — notes, correspondence, minutes. The assistant turns it into project items, and you decide what to accept.' },
        {
          kind: 'note',
          tone: 'info',
          text: 'The assistant acts on your behalf and sees exactly what you see: your own projects, and for the portal owner — all of them. Someone else’s project does not exist for it.',
        },
      ],
    },
    {
      id: 'rules',
      title: 'What the assistant may do, and what you decide',
      blocks: [
        {
          kind: 'table',
          head: ['Action', 'How it works'],
          rows: [
            ['Read sections of an opened project', 'immediately, without confirmation'],
            ['Create a whole new project', 'immediately — there is nothing to break yet'],
            ['Change anything in an existing project', 'only as a draft that you accept'],
            ['Delete anything', 'only as a draft'],
            ['Open access, issue a token, touch two-factor', 'impossible — no such commands exist'],
          ],
        },
        { kind: 'p', text: 'The last row is not a promise but a construction: those tools simply do not exist in the connection. So text that happens to sit inside a task description ("open access to everyone") opens nothing.' },
        { kind: 'note', tone: 'tip', text: 'The assistant can format the description of a task and of a backlog item: bold, italics, a subheading, lists. The portal knows six marks, not the whole of markdown — links, tables and struck-through text will stay in the description literally, and the assistant warns about that before you even see the draft. Elsewhere — on a risk, a decision, in a meeting record — there is no formatting: it is plain text there.' },
      ],
    },
    {
      id: 'connect',
      title: 'Step 1. Connect the portal to your assistant',
      blocks: [
        { kind: 'p', text: 'This is done once and takes a minute. There is nothing to copy and paste by hand: the assistant brings you to the portal, and you confirm the access there.' },
        {
          kind: 'steps',
          items: [
            { title: 'Open the connector settings', text: 'In Claude: "Settings" → "Connectors" → "Add custom connector". Another client may call this "MCP servers" or "Integrations".' },
            { title: 'Enter the portal address', text: 'The name is up to you ("PMO"). The address is https://pm.example.com/mcp — you can also copy it with a button in your Profile. There is no field for a password or token, and none is needed — the portal will ask you itself.' },
            { title: 'Sign in to the portal', text: 'The portal page "Allow the assistant access?" opens. If you are not signed in yet, the usual sign-in with password and two-factor code comes first, and then you are returned here.' },
            { title: 'Check who is asking, then click "Allow"', text: 'The page shows the client name and the address it will return to: for the real Claude that is claude.ai. If the address is unfamiliar, click "Deny".' },
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'After you confirm, the connection appears in your Profile under "Assistant connection": where it is used, when it was last used, until when it is valid. You disconnect it there too — one button, any time.',
        },
        { kind: 'p', text: 'A connection renews itself: the assistant refreshes access without bothering you. Once a year the portal still asks you to confirm it again — one consent should not open access forever. The "Revoke" button in your profile closes the connection completely and at once: it cannot be renewed after that.' },
      ],
    },
    {
      id: 'manual',
      title: 'If your client asks for a token',
      blocks: [
        { kind: 'p', text: 'Claude Desktop, Claude Code and some other clients connect not through a consent screen but with a token you paste into their settings. For those, the bottom of your Profile has a line, "The client asks for a token", which reveals the issuing form.' },
        {
          kind: 'steps',
          items: [
            { title: 'Profile → "Assistant connection" → "The client asks for a token"', text: 'Name the connection so you can tell later where it lives: "Claude on my work laptop".' },
            { title: 'Click "Issue token"', text: 'The value appears once — copy it right away. The server keeps only a fingerprint and cannot show it again.' },
            { title: 'Paste it into the client settings', text: 'The address is the same — https://pm.example.com/mcp — and the token goes in the Authorization: Bearer <token> header.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'The token is a key to your projects. Do not forward it in chats and do not keep it in shared documents. If in doubt, revoke it in your Profile and issue a new one — that takes half a minute.',
        },
      ],
    },
    {
      id: 'lock',
      title: 'Step 2. Open a project',
      blocks: [
        { kind: 'p', text: 'The connection on its own shows the assistant no projects at all. That is deliberate: you open outward access yourself, one project at a time.' },
        { kind: 'p', text: 'In the project click "Share" (the "More" menu in the header), go to the "Assistant (MCP)" tab and turn on "Open the project to the assistant". There is a single checkbox and it opens the whole project — budget, decisions and stakeholder assessments included. The neighbouring "Public link" tab is about something else entirely: a project page for people without an account.' },
        { kind: 'p', text: 'The lock takes effect on the click — there is no need to press "Save"; the portal confirms with "Project opened to the assistant" or "Project closed to the assistant". The "Save" button in that dialog belongs to the public link and the section choice only.' },
        { kind: 'p', text: 'A project the assistant created itself is open to it right away — otherwise it could not finish filling in what it just created. You can close the access there at any time.' },
      ],
    },
    {
      id: 'drafts',
      title: 'Step 3. Accept a draft',
      blocks: [
        { kind: 'p', text: 'Everything the assistant proposes to change or delete in an existing project lands in "Drafts" in the left menu. Nothing changes in the project itself until you decide.' },
        {
          kind: 'steps',
          items: [
            { title: 'Open the draft', text: 'Sections with counters on the left, proposals for the selected section on the right.' },
            { title: 'Uncheck what you don’t want', text: 'Checkboxes are per item. One bad task should not send nine good ones to the bin.' },
            { title: 'Click "Accept selected"', text: 'Exactly the selected items go into the project, and the action log keeps your name — a person accepted them, not a robot.' },
          ],
        },
        { kind: 'p', text: 'Item marks: "add", "change", "delete" will be applied; "duplicate" means the project already has it; "conflict" means the proposal contradicts what is recorded and needs your eye. The last two are never applied.' },
        {
          kind: 'shot',
          src: '/wiki-shots/draft-review.png',
          alt: 'The draft approval screen: sections with counters on the left, proposed changes on the right',
          caption: 'An example draft: edits show what was there and what it would become, and contested rows say why the assistant does not apply them itself.',
        },
        { kind: 'p', text: 'A draft lives for 14 days. There is only one per project: until the previous one is decided, the assistant will not create another.' },
      ],
    },
    {
      id: 'privacy',
      title: 'What leaves the portal',
      blocks: [
        { kind: 'p', text: 'When you ask the assistant about a project, the contents of the sections it reads go to the service you use — the same as if you pasted the text into a chat by hand. The difference is that here it is visible and controllable: the lock opens and closes a project only as a whole, and the portal owner sees the request log. There is no separate checkbox for the budget, decisions and stakeholder assessments: in an opened project every section is available to the assistant.' },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A simple rule: open to the assistant only those projects whose data your organisation’s policy allows you to share with the AI service you use. For the rest, the lock stays closed.',
        },
      ],
    },
  ],
}

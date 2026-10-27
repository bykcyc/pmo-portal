import type { WikiPage } from '../types'

export const risksPage: WikiPage = {
  slug: 'risks',
  title: 'Risk register',
  summary: 'What could go wrong, how bad it would be and who is watching it.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/risks`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'A risk is something that has not happened yet but still might. A risk written down gets discussed in good time; an unwritten one turns into an emergency later.' },
        { kind: 'p', text: 'The register has a second purpose that surfaces at an unpleasant moment. When a risk materialises, the conversation is either "we knew, and here is what we were doing about it" or "why did nobody think of this". The difference between those two conversations is three lines written a month earlier.' },
        { kind: 'note', tone: 'tip', text: 'Three to five risks are plenty. A project with no risks at all usually means nobody has thought about them, and a list of thirty is one nobody reads.' },
      ],
    },
    {
      id: 'fields',
      title: 'What a risk is made of',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Risk', 'An "if — then" statement. "The contractor" is not a risk. "The contractor will not be on site on time and installation slips by a month" is.'],
            ['Category', 'Technical, financial, operational, external, personnel. Not for the sake of reporting: when four risks out of five are external, it is visible that the project rests on other people’s promises.'],
            ['Probability and impact', 'Three steps each — high, medium, low. The portal turns them into a score (see below).'],
            ['Status', 'Open, mitigated, accepted, closed, occurred.'],
            ['Owner', 'A named person, not "the team is watching it". The owner is whoever notices first and has some leverage.'],
            ['Description', 'What exactly would happen, and by what signs you would know it has started.'],
            ['Mitigation plan', 'What you do IN ADVANCE so the risk does not happen.'],
            ['Contingency plan', 'What you do IF it happens anyway.'],
          ],
        },
        { kind: 'p', text: 'Long fields are clipped to the column width in the table. To read and fill in a risk in full, open its card — the pencil button at the end of the row. The button next to it opens the history: who changed the ratings and when. That is how you see whether a risk is fading or building.' },
      ],
    },
    {
      id: 'score',
      title: 'Probability, impact, score',
      blocks: [
        { kind: 'p', text: 'High counts as 3, medium as 2, low as 1. The score is probability times impact, from 1 to 9. The row is coloured by it: 7 and above red, 4 to 6 amber, 3 and below green. Sorting by score puts the meeting’s opening item at the top.' },
        {
          kind: 'table',
          head: ['Probability and impact', 'Score', 'What the portal suggests'],
          rows: [
            ['High and high', '9', 'Avoid: change the plan so the risk disappears — another contractor, another technology, another date.'],
            ['High and medium (or the reverse)', '6', 'Avoid: it costs more to live through it than to change the plan.'],
            ['Medium and medium; high and low', '4 and 3', 'Mitigate: keep the plan, but reduce the likelihood or the damage in advance.'],
            ['Everything else', '1–2', 'Accept: keep it in view, no separate action needed.'],
          ],
        },
        { kind: 'p', text: 'The "Action" column shows that suggestion by itself. At the bottom of the tab the same risks are laid out on a 3×3 matrix — one glance tells you whether they have piled up in the red corner or are spread out.' },
        { kind: 'note', tone: 'info', text: 'The suggestion is advice, not an order. A risk scoring 9 is sometimes accepted deliberately because the alternative costs more. Then write exactly that in the contingency plan — it is a decision, not an oversight.' },
      ],
    },
    {
      id: 'plans',
      title: 'Two plans, not one',
      blocks: [
        { kind: 'p', text: 'The mitigation plan and the contingency plan answer different questions, and mixing them up is the most common mistake in a register. "Call the contractor weekly" is mitigation: it lowers the likelihood. "If the contractor misses the date, our own crew does the installation, 40 hours of work" is contingency: it lowers the damage once mitigation has failed.' },
        { kind: 'note', tone: 'warn', text: 'A risk scoring 6 or more must have a plan, otherwise the "On this page" panel will keep reminding you — and fairly so: a high risk without a plan is just recorded anxiety.' },
        { kind: 'p', text: 'A good plan passes one test: does it tell you what to do tomorrow morning, and does the risk owner have the authority to do it? "Keep it under control" does not pass.' },
      ],
    },
    {
      id: 'rhythm',
      title: 'A rhythm for the register',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Review weekly, or before each status report: ratings move with the project instead of staying as they were at kick-off.',
            'New risks usually surface in meetings — enter them straight away, while the wording is fresh.',
            'A risk that has not moved for three months either becomes "Accepted" or gets closed. A register of dead rows stops being read at all.',
            'A risk that came true is not deleted: set it to "Occurred", and the work it causes becomes a task in the work plan.',
          ],
        },
        { kind: 'p', text: 'Closed and occurred risks stay in the project on purpose. On the next similar project they are a ready-made list of what to think about early — and at a review it is visible which ratings were close to the truth.' },
      ],
    },
    {
      id: 'look',
      title: 'What it looks like',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/risks.png', alt: 'Risk register with probability and impact ratings' },
      ],
    },
  ],
}

export const decisionsPage: WikiPage = {
  slug: 'decisions',
  title: 'Decision log',
  summary: 'What was decided, why it went that way and who decided it.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/decisions`,
  sections: [
    {
      id: 'why',
      title: 'Why it matters',
      blocks: [
        { kind: 'p', text: 'The most underrated section. Six months on, nobody remembers why this option won, and the whole debate starts again. Two lines of notes save hours.' },
        { kind: 'p', text: 'Record not just the decision but the reasoning behind it: what the alternatives were and why you picked this one. The rationale is what makes a decision reviewable. If circumstances change, it shows which assumption stopped holding; without it, all you can do is argue from scratch.' },
        { kind: 'p', text: 'The second benefit shows up at handover. A new manager reads the decision log and understands in half an hour why the project is built this way — instead of a week of "but why is this like that?".' },
      ],
    },
    {
      id: 'fields',
      title: 'What an entry is made of',
      blocks: [
        {
          kind: 'table',
          head: ['Field', 'What to put there'],
          rows: [
            ['Decision', 'One affirmative line: "We move to contractor X", "The pilot runs at one warehouse, not three".'],
            ['Date', 'When it was decided, not when it was typed in.'],
            ['Decided by', 'A person or a body: "Steering committee", "Sponsor". Not about blame — about knowing who to revisit it with.'],
            ['Status', 'Active, superseded, revoked.'],
            ['Description', 'The context: what was going on and why a decision was needed at all.'],
            ['Rationale', 'Why this option won. The key field of the entry.'],
            ['Alternatives', 'What else was considered and why it did not fit. Without this, someone returns to a rejected option as a "new idea" six months later.'],
            ['Impact', 'What the decision changed: dates, budget, scope, somebody’s work.'],
          ],
        },
        { kind: 'p', text: 'The entry number (D-01, D-02 …) is assigned by the portal — handy to refer to in a status report or a meeting.' },
      ],
    },
    {
      id: 'statuses',
      title: 'Decisions are not rewritten',
      blocks: [
        { kind: 'p', text: 'Changed your mind? Create a new decision and mark the old one "Superseded". Cancelled without a replacement — "Revoked". Editing the text of a past decision is not on: it removes exactly what the log exists for — what was considered right at the time and what it was based on.' },
        { kind: 'p', text: 'Hence a simple reading rule: "Active" is what we go by today; "Superseded" and "Revoked" are history you do not act on, but worth re-reading before a similar fork in the road.' },
      ],
    },
    {
      id: 'howto',
      title: 'How to fill it in',
      blocks: [
        { kind: 'p', text: 'An active decision needs a rationale and a date, otherwise the "On this page" panel will keep pointing at it. Write it the same day: a week later the fact survives, but the arguments are the first thing to go.' },
        { kind: 'p', text: 'Not everything discussed is a decision. The log is for what changes the direction of the project: choosing a supplier, cutting scope, moving a date, dropping a feature. "We agreed to call on Thursday" is an action item in the meeting minutes, not a decision.' },
        { kind: 'note', tone: 'info', text: 'Decisions taken in a meeting land here automatically when the meeting is finalized — there is no need to copy them across by hand. Create such a decision in both the log and the minutes and you end up with two identical entries.' },
      ],
    },
  ],
}

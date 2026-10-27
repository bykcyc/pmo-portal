import type { WikiPage } from '../types'

export const passportPage: WikiPage = {
  slug: 'passport',
  title: 'Projekta pase',
  summary: 'Projekta vizītkarte: mērķis, vadītājs, termiņi, statuss.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/passport`,
  sections: [
    {
      id: 'what',
      title: 'Kas tas ir',
      blocks: [
        { kind: 'p', text: 'Pase atbild uz jautājumu «kas šis ir par projektu» tam, kurš to redz pirmo reizi: kāpēc tas vajadzīgs, kurš to vada, līdz kuram termiņam un kādā stāvoklī tas ir.' },
        { kind: 'p', text: 'Minimums, bez kura projektu nav ko apspriest, — mērķis, projekta vadītājs un plānotā pabeigšana. Kamēr to nav, portāls par to atgādinās labajā panelī.' },
      ],
    },
    {
      id: 'look',
      title: 'Kā tas izskatās',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/passport.png', alt: 'Projekta pase: forma ar mērķi, vadītāju un termiņiem',
          caption: 'Pa kreisi pases forma, pa labi — ieteikumi un projekta sagatavotības progress.' },
      ],
    },
    {
      id: 'fields',
      title: 'Lauki',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Nosaukums', 'Īsi un atpazīstami. Projekta kodu portāls piešķir pats.'],
            ['Mērķis', 'Kāpēc projekts vajadzīgs. Nevis uzdevumu saraksts, bet rezultāts: kas mainīsies, kad būsim pabeiguši.'],
            ['Projekta rezultāts', 'Ko tieši uzņēmums saņems: produktu, dokumentu, iedarbinātu procesu.'],
            ['Apjoms', 'Kas projektā ietilpst un, ne mazāk svarīgi, kas tajā NEIETILPST.'],
            ['Projekta vadītājs', 'Kurš atbild. Izvēlas no cilvēku kataloga.'],
            ['Klients', 'Kam mēs to darām.'],
            ['Statuss un prioritāte', 'Plānošana / aktīvs / apturēts / pabeigts.'],
            ['Plānotie datumi', 'Sākums un pabeigšana. Portāls neļaus likt pabeigšanu agrāk par sākumu.'],
          ],
        },
      ],
    },
    {
      id: 'versions',
      title: 'Versija un žurnāls',
      blocks: [
        { kind: 'p', text: 'Viena cilvēka labojumus pēc kārtas portāls salīmē vienā versijā: kamēr labojat pasi, numurs neaug no katra komata. Sesija ilgst piecpadsmit minūtes — pēc pauzes nākamais labojums sāks jaunu versiju. Cita cilvēka labojumi ar jūsējiem nesalīp nekad.' },
        { kind: 'p', text: 'Ja sesijas beigās esat atgriezis visu, kā bija, ieraksts pazūd un versijas numurs atkāpjas: portāls neuzskata par versiju to, kurā nekas nav mainījies.' },
        { kind: 'note', tone: 'tip', text: 'Poga ar slēdzeni blakus drukāšanai fiksē versiju apzināti. Tā vajadzīga tieši vienā gadījumā: pase aizgājusi saskaņošanai vai drukā, un versija 1.0003 pēc stundas nedrīkst nozīmēt citu dokumentu.' },
      ],
    },
    {
      id: 'saving',
      title: 'Saglabāšana',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'Pase saglabājas pati, pāris sekundes pēc tam, kad pārstājat rakstīt. Pogas «Saglabāt» nav: blakus virsrakstam redzams «Saglabā…», pēc tam «Saglabāts 14:32».',
        },
        { kind: 'p', text: 'Ja mēģināsiet aiziet no lapas ar nesaglabātiem labojumiem — uz citu sadaļu, pa saiti pašā pasē, caur kreiso izvēlni vai aizverot cilni — portāls pajautās, ko darīt: saglabāt un turpināt, turpināt bez saglabāšanas vai palikt.' },
      ],
    },
    {
      id: 'derived',
      title: 'Ko portāls aprēķina pats',
      blocks: [
        { kind: 'p', text: 'Projekta kodu piešķir izveides brīdī, un to nelabo. Progress, ko redzat projektu sarakstā un portfelī, ir pabeigto uzdevumu daļa, nevis vidējais no kolonnas «Progress»: atsevišķu uzdevumu procenti tajā neietilpst.' },
        { kind: 'p', text: 'Bloks «Galvenie posmi» pasē ir jūsu darbu plāna fāzes. Atsevišķi to neaizpilda: parādījās fāzes plānā — parādījās posmi šeit.' },
      ],
    },
    {
      id: 'extras',
      title: 'Kas vēl ir šajā lapā',
      blocks: [
        {
          kind: 'ul',
          items: [
            'PDF — poga atver pārlūka druku, no turienes pasi var saglabāt kā failu.',
            'Saistītās sadaļas — zem formas redzama komanda, riski, KPI un galvenie uzdevumi. Poga «Atvērt» ved tieši uz vajadzīgo sadaļu.',
            'Darbību žurnāls — kurš un ko projektā ir mainījis.',
            'Nodot VP — nomainīt projekta vadītāju; līdzvadītājus pievieno turpat.',
          ],
        },
      ],
    },
  ],
}

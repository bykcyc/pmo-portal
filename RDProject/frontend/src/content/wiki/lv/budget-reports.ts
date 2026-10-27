import type { WikiPage } from '../types'

export const budgetPage: WikiPage = {
  slug: 'budget',
  title: 'Budžets',
  summary: 'Izdevumu un ienākumu posteņi, sadalīti pa mēnešiem: plāns, fakts un cik palicis.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/budget`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc',
      blocks: [
        { kind: 'p', text: 'Ja projektam ir nauda, to skaita šeit. Sadaļa atbild uz trim jautājumiem: cik kopā ieplānots, cik jau iztērēts un vai pietiks līdz beigām. Ja projektam budžeta nav, sadaļu var neaiztikt — tā nav obligāta.' },
        { kind: 'p', text: 'Iemesls vest budžetu portālā, nevis savā tabulā, ir viens: šie skaitļi paši nonāk statusa atskaitē un portfelī. Fails uz jūsu diska tur nenonāks, un reizi mēnesī jūs to pārrakstīsiet ar roku.' },
      ],
    },
    {
      id: 'structure',
      title: 'No kā sastāv',
      blocks: [
        { kind: 'p', text: 'Budžets ir posteņu saraksts. Postenis tiek izveidots vienu reizi un dzīvo visu projektu.' },
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Nosaukums', 'Cilvēkam saprotams: «Uzņēmēja izstrāde», «Gada licences», «Operatoru apmācība».'],
            ['Kategorija', 'No saraksta. Izdevumiem un ienākumiem ir atsevišķi komplekti — ienākumu kategorija izdevumos nenokļūs.'],
            ['Summa (plāns)', 'Cik kopā ieplānots šim postenim visā projektā.'],
            ['Piezīmes', 'Pamatojums: līguma numurs, kas saskaņoja, no kurienes skaitlis.'],
          ],
        },
        { kind: 'p', text: 'Izdevumu kategorijas: darba samaksa, uzņēmēji un konsultanti, materiāli, iekārtas, programmatūra un licences, komandējumi, telpu noma un uzturēšana, pieskaitāmās izmaksas, mārketings, apmācība, juridiskie pakalpojumi un apdrošināšana, rezerve neparedzētajam, citi. Ienākumu: pakalpojumi, produktu pārdošana, abonementi, investīcijas, granti, licenču maksas, komisijas un partnerības, noma, reklāma, procenti, citi.' },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Rezervi neparedzētajam turiet kā atsevišķu posteni, nevis kā «rezervi», izsmērētu pa pārējiem. Tad ir redzams, cik no tās palicis, un saruna ar vadību notiek par skaitli, nevis par sajūtu.',
        },
      ],
    },
    {
      id: 'views',
      title: 'Divi skati: aplēses un pa mēnešiem',
      blocks: [
        { kind: 'p', text: 'Augšā ir pārslēdzējs. «Aplēses» — vienkāršs posteņu saraksts ar kopsummām. «Pa mēnešiem» — tā pati tabula, izvērsta pa izvēlētā gada mēnešiem: katrā šūnā plāns un fakts.' },
        { kind: 'p', text: 'Tie strādā kopā: «Aplēsēs» jūs pasakāt, cik naudas postenim kopumā; «Pa mēnešiem» — kad tieši tā tiek tērēta. Kolonna «Brīvi» rāda starpību: cik no plānotās summas vēl nav sadalīts nevienam mēnesim. Nulle tur nozīmē, ka plāns ir izklāts pilnībā.' },
        {
          kind: 'shot',
          src: '/wiki-shots/budget-monthly.png',
          alt: 'Mēneša budžeta plāns: plāna un fakta rindas pa gada mēnešiem',
          caption: 'Katram postenim ir divas rindas: plāns mēnesim un fakts par to. Poga sadaļas augšā saucas «Mēneša plāns».',
        },
      ],
    },
    {
      id: 'fact',
      title: 'Kā ievadīt faktu',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'Faktu ievada TIKAI pa mēnešiem. Kolonna «Summa (fakts)» kopsarakstā nav ievades lauks — tā saskaitās no mēnešu šūnām. Ja faktu ierakstīsiet citur, sarakstā tas neparādīsies, un jūs skatīsieties uz tukšu kolonnu, kamēr nauda ir iztērēta.',
        },
        {
          kind: 'steps',
          items: [
            { title: 'Pārslēdzieties uz «Pa mēnešiem»', text: 'Un izvēlieties gadu — tabula rāda vienu gadu vienlaikus.' },
            { title: 'Atrodiet posteņa rindu un mēnesi', text: 'Šūnā ir divi skaitļi: plāns šim mēnesim un fakts par to.' },
            { title: 'Ievadiet faktu par SLĒGTU mēnesi', text: 'Fakts par nākotni nozīmē, ka nauda jau iztērēta uz priekšu. Portāls to neaizliedz, bet skaitļi pārstāj nozīmēt to, kam jānozīmē.' },
          ],
        },
        { kind: 'p', text: 'Ērts ritms — reizi mēnesī, pirmajās dienās: noslēdzāt mēnesi, ievadījāt faktu pa visiem posteņiem, paskatījāties uz novirzi. Tās ir piecas minūtes, ja dara regulāri, un puse dienas, ja atceras ceturkšņa beigās.' },
      ],
    },
    {
      id: 'checks',
      title: 'Ko pārbaudīt pirms atskaites',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Mēnešu plānu summa sakrīt ar posteņa plāna summu — citādi «Brīvi» rādīs atlikumu, kāda realitātē nav.',
            'Visiem pagājušajiem mēnešiem ievadīts fakts, kaut vai nulle: tukša šūna un «iztērējām neko» ir dažādas lietas, kas izskatās vienādi.',
            'Lielas novirzes paskaidrotas piezīmēs. Pēc pusgada jūs pats neatcerēsieties, kāpēc martā iznāca divreiz vairāk.',
          ],
        },
        { kind: 'p', text: 'Panelis «Šajā lapā» labajā pusē pats norāda, kā trūkst: tas pārbauda tieši to pašu, ko dzīvs vadītājs, tikai neaizmirst.' },
      ],
    },
  ],
}

export const reportsPage: WikiPage = {
  slug: 'reports',
  title: 'Statusa atskaites',
  summary: 'Desmit minūtes nedēļā — un vadība ir lietas kursā bez sazvanīšanās.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/reports`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc',
      blocks: [
        { kind: 'p', text: 'Regulāra īsa atskaite aizstāj statusa zvanus: vadītājam nav jājautā, kā iet, bet jums — jāstāsta to pieciem pēc kārtas.' },
        { kind: 'p', text: 'Otrs uzdevums atklājas vēlāk. Atskaites sakrājas projekta vēsturē, un pēc pusgada ir redzams, kad viss aizgāja greizi, ko tad izlēma un kāpēc. Bez tā analīze pārvēršas strīdā par to, kurš ko atceras.' },
      ],
    },
    {
      id: 'rag',
      title: 'Zaļš, dzeltens, sarkans',
      blocks: [
        { kind: 'p', text: 'Krāsu liek atsevišķi pa trim līnijām: projekts kopumā, termiņi un budžets. Projekts var iet pēc naudas un kavēties pēc termiņiem — tās ir dažādas sarunas.' },
        {
          kind: 'table',
          head: ['Krāsa', 'Nozīme', 'Ko dara vadītājs'],
          rows: [
            ['Zaļš', 'Ejam pēc plāna, iejaukšanās nav vajadzīga.', 'Neko. Izlasa un aizver.'],
            ['Dzeltens', 'Ir novirze, tiekam galā paši, bet jums jāzina.', 'Tur redzeslokā, gatavojas palīdzēt.'],
            ['Sarkans', 'Vajadzīga palīdzība vai lēmums no augšas.', 'Iejaucas: cilvēki, nauda vai lēmums.'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Dzeltens un sarkans bez sadaļas «Nākamie soļi» ir bezjēdzīgi un kaitinoši: vadītājam jāzina ne tikai tas, kas ir slikti, bet arī ko jūs plānojat darīt un kas jums no viņa vajadzīgs.',
        },
        { kind: 'p', text: 'Bieža kļūda — turēt zaļo līdz pēdējam, lai «neuztrauktu». Dzeltens laikus maksā mazāk nekā sarkans pēkšņi: otrajā gadījumā palīdzēt jau gandrīz nav ar ko.' },
      ],
    },
    {
      id: 'auto',
      title: 'Ko portāls aizpilda pats',
      blocks: [
        { kind: 'p', text: 'Veidojot atskaiti, tajā ievelkas perioda galvenie uzdevumi un budžeta momentuzņēmums: plāns, fakts un prognoze uz atskaites datumu. Skaitļus pārrakstīt nevajag — pietiek tos pārbaudīt un ar vārdiem pierakstīt to, kas skaitļos nav redzams.' },
        { kind: 'p', text: 'No tā izriet vienkārša lieta: vispirms sakārtojiet darbu plānu un budžetu, tikai tad veidojiet atskaiti. Otrādā secībā jūs iegūsiet tukšuma momentuzņēmumu un labosiet to ar roku.' },
      ],
    },
    {
      id: 'rhythm',
      title: 'Ritms un noteikumi',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Reizi nedēļā vai reizi divās — bet vienā un tajā pašā dienā. Paredzamība ir svarīgāka par biežumu.',
            'Atskaite ir momentuzņēmums uz datumu. Vecās nepārraksta: nepareiza atskaite paliek vēsturē, un blakus parādās jauna ar labojumu.',
            'Rakstiet tā, lai saprastu cilvēks, kas iepriekšējo atskaiti nav lasījis. «Turpinām darbu pie uzdevuma 3.2» nenozīmē neko.',
            'Sliktās ziņas — sākumā. Tieši tās arī meklē.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Gatavu atskaiti izgūst PDF formātā ar drukas pogu un pievieno vēstulei vai iemet čatā. Izsūtne no portāla pēc noklusējuma ir izslēgta un tiek ieslēgta ar SMTP iestatījumu.',
        },
      ],
    },
  ],
}

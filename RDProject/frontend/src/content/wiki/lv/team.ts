import type { WikiPage } from '../types'

export const teamPage: WikiPage = {
  slug: 'team',
  title: 'Komanda un lomas',
  summary: 'Kas piedalās projektā un par ko katrs atbild.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/team`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Dalībnieku saraksts ar lomām. Tas atbild uz jautājumu «pie kā iet», kad kaut kas nav skaidrs, un neļauj projektam turēties uz viena cilvēka.' },
        { kind: 'p', text: 'Pārbaudīt to ir vienkārši: ja rīt dosieties atvaļinājumā, vai pēc šī saraksta svešs cilvēks sapratīs, kurš veido integrāciju, kurš pieņem darbu un kam zvanīt, ja apstājies serveris? Ja nē, saraksts tiek vests formas pēc.' },
        { kind: 'note', tone: 'tip', text: 'Loma projektā nav amats. «Analītiķis», «ieviesējs», «testē no grāmatvedības puses» — tas ir saprotamāk nekā «vadošais speciālists».' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv rinda',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Vārds', 'Izvēlēties no cilvēku kataloga. Brīvs teksts — tikai tiem, kuru katalogā nav.'],
            ['Amats', 'Tiek ievietots no Bitrix24 automātiski. Tas ir cilvēka štata amats, nevis tas, ko viņš dara projektā.'],
            ['Loma projektā', 'Ko cilvēks dara tieši šeit. Obligāts lauks — kamēr tas ir tukšs, portāls atgādinās.'],
            ['E-pasts un tālrunis', 'Tiek ievietoti no kataloga. Ar roku aizpildiet tikai tad, ja cilvēka tur nav.'],
          ],
        },
        { kind: 'p', text: 'Cilvēka izvēle no kataloga nav formalitāte un nav par ievades ērtumu: tieši tā rinda tiek sasaistīta ar reālu portāla cilvēku. No šīs saites atkarīgs, vai uzdevumi nonāks viņa sadaļā «Mani uzdevumi» un vai viņš vispār saņems paziņojumu.' },
        { kind: 'note', tone: 'warn', text: 'Ar tekstu ierakstīts vārds netiek sasaistīts ne ar vienu. No malas rinda izskatās tieši tāda pati, tāpēc kļūdu pamana vēlu — parasti tad, kad cilvēks saka, ka nav redzējis nevienu projekta uzdevumu.' },
      ],
    },
    {
      id: 'howto',
      title: 'Kuru iekļaut',
      blocks: [
        { kind: 'p', text: 'Tos, kas reāli dara darbu un ar kuriem jūs sadarbosieties: izpildītājus, analītiķi, testētāju no pasūtītāja puses, apakšuzņēmēja pārstāvi. Vadītāji, kas projektu ietekmē, bet tajā nestrādā, — nevis šeit, bet sadaļā «Ieinteresētās puses».' },
        { kind: 'p', text: 'Apakšuzņēmējus un ārējos konsultantus iekļaut ir vērts: viņi ir daļa no strādājošās komandas, pat ja portālā viņiem nav konta. Loma projektā viņiem ir vēl jo svarīgāka — pēc tās vēlāk ir skaidrs, par ko no viņiem prasīt.' },
        { kind: 'p', text: 'Sastāvs ir dzīvs. Cilvēks aizgājis no projekta — rindu nedzēš klusi beigās, bet atjauno gaitā: saraksts, kas atšķiras no realitātes, ir kaitīgāks par tukšu, jo pēc tā zvana nepareizajiem cilvēkiem.' },
      ],
    },
    {
      id: 'access',
      title: 'Komanda nav piekļuve',
      blocks: [
        { kind: 'p', text: 'Pievienošana komandai neatver cilvēkam projektu portālā. Tiesības redzēt un labot projektu dod tikai iecelšana par līdzvadītāju (projekta galvenē, blakus «Nodot PV») vai portfeļa vadītāja loma.' },
        { kind: 'p', text: 'Ko komandas dalībnieks tomēr redzēs — tie ir viņam uzticētie ieraksti sadaļā «Mani uzdevumi»: uzdevumi, dotie uzdevumi, riski, kuru atbildīgais viņš ir. Pats projekts neatvērsies, un tā nav kļūda, bet atšķirība starp «darbs ir uz manis» un «es vadu projektu».' },
      ],
    },
  ],
}

export const stakeholdersPage: WikiPage = {
  slug: 'stakeholders',
  title: 'Ieinteresētās puses un ietekme',
  summary: 'Tie, kas projektu ietekmē vai no tā ir atkarīgi, — un kā ar viņiem strādāt.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/stakeholders`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Ieinteresētā puse nav komandas dalībnieks, bet gan tas, kura viedoklis spēj projektu paātrināt vai apturēt: sponsors, klients, blakus nodaļas vadītājs, dažreiz ārējs partneris.' },
        { kind: 'p', text: 'Vismaz divi ir vajadzīgi vienmēr: sponsors (kas dod resursu) un klients (kam mēs to darām). Tālāk — tie, kurus projekts skar: kura nodaļai mainīsies ierastā darba kārtība, kas saskaņo iepirkumu, kura datus jūs gatavojaties aiztikt.' },
        { kind: 'note', tone: 'tip', text: 'Projekti reti apstājas tehnikas dēļ. Biežāk — cilvēka dēļ, par kuru atcerējās divas nedēļas vēlāk, nekā vajadzēja.' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv rinda',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Vārds', 'No kataloga — tad e-pasts un tālrunis ievietosies paši.'],
            ['Loma', 'Loma attiecībā pret projektu: sponsors, pasūtītājs, saskaņotājs, blakus nodaļas vadītājs.'],
            ['Tips', 'Iekšējs vai ārējs. Ārējiem ir cits ātrums: viņus nevar pasaukt uz plānošanas sapulci un nevar uzrakstīt «ienāc, paskaidrošu».'],
            ['Ietekme un interese', 'Divi vērtējumi no 1 līdz 10. No tiem veidojas matrica.'],
            ['Iesaistes stratēģija', 'Ko tieši jūs ar šo cilvēku darāt: «iknedēļas zvans», «demo reizi sprintā», «vēstule pēc katra posma».'],
            ['Piezīmes', 'Kas par cilvēku noder zināt: no kā baidās, kas viņam ir svarīgi, ar kuru rēķinās.'],
          ],
        },
      ],
    },
    {
      id: 'matrix',
      title: 'Ietekme un interese',
      blocks: [
        { kind: 'p', text: 'Ietekme ir tas, cik lielā mērā cilvēks spēj ietekmēt projekta likteni. Interese — cik ļoti tas viņam vispār ir svarīgi. Abi vērtējumi skalā no 1 līdz 10; 6 un vairāk portāls uzskata par augstu. Vērtējiet pēc faktiskā svara, nevis pēc amata: noliktavas vadītājam ietekme uz ieviešanas projektu mēdz būt lielāka nekā direktoram.' },
        {
          kind: 'table',
          head: ['Kombinācija', 'Kvadrants portālā', 'Ko darīt'],
          rows: [
            ['Augsta ietekme, augsta interese', 'Rūpīgi vadīt', 'Turiet cieši lietas kursā: šis cilvēks ir jūsu sabiedrotais vai galvenais risks.'],
            ['Augsta ietekme, zema interese', 'Turēt apmierinātu', 'Nepazaudējiet: ja uzzinās par vēlu, apgriezīs projektu otrādi.'],
            ['Zema ietekme, augsta interese', 'Informēt', 'Informējiet un izmantojiet kā atgriezeniskās saites avotu.'],
            ['Zema ietekme, zema interese', 'Monitorings', 'Pietiek ar kopīgo izsūtni.'],
          ],
        },
        { kind: 'p', text: 'Kvadrants tiek aprēķināts automātiski un redzams tabulā, bet cilnes apakšā tie paši cilvēki ir izklāti matricā. Praktiskais labums no tās ir viens: katram no augšējās puses jābūt uzrakstītai iesaistes stratēģijai. Ja tur ir tukšs, ar šo cilvēku jūs strādājat pēc nojautas.' },
        { kind: 'note', tone: 'info', text: 'Bez abiem vērtējumiem cilvēks matricā neparādīsies — tā paliks pustukša.' },
      ],
    },
  ],
}

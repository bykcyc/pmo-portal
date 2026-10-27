import type { WikiPage } from '../types'

export const projectsPage: WikiPage = {
  slug: 'projects',
  title: 'Projektu saraksts',
  summary: 'Visi jūsu projekti: izveide, meklēšana, arhīvs, veidnes.',
  group: 'portal',
  appRoute: () => '/projects',
  sections: [
    {
      id: 'list',
      title: 'Saraksts',
      blocks: [
        { kind: 'p', text: 'Šeit redzami projekti, kurus vadāt jūs vai kuros esat līdzvadītāja lomā. Svešie projekti sarakstā neparādās — tā nav kļūda, bet piekļuves nodalīšana.' },
        { kind: 'p', text: 'Skatu var pārslēgt starp kartītēm un tabulu; tabulā kolonnas sakārto, uzklikšķinot uz virsraksta. Ir filtri pēc statusa un meklēšana.' },
      ],
    },
    {
      id: 'create',
      title: 'Izveide',
      blocks: [
        { kind: 'p', text: 'Poga «Izveidot projektu». Pirmajā solī vajadzīgs tikai nosaukums — kodu portāls piešķirs pats. Tālāk vednis piedāvās uzreiz pievienot pirmos uzdevumus, bet tas nav obligāti.' },
        { kind: 'p', text: 'Blakus ir imports no Excel: ja projekts jau ir aprakstīts jūsu failā (pase, darbu plāns, riski), to var ievilkt veselu.' },
      ],
    },
    {
      id: 'whose',
      title: 'Kā saraksts tas ir',
      blocks: [
        { kind: 'p', text: 'Projekta vadītājs šeit redz savus projektus — tos, kuros viņš ir galvenais vadītājs vai līdzvadītājs. Portfeļa vadītājs tajā pašā sarakstā redz visus uzņēmuma projektus. Tukšs saraksts jaunam vadītājam nav bojājums: projekti vēl nav piešķirti.' },
        { kind: 'note', tone: 'info', text: 'Filtrs «PV» projektu sarakstā meklē tikai pēc galvenā vadītāja. Tas pats filtrs «Portfolio» ņem vērā arī līdzvadītājus — tāpēc vizuāli vienādi filtri dod dažādas atbildes.' },
      ],
    },
    {
      id: 'lifecycle',
      title: 'Arhīvs, veidne, kopija',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Arhīvs — projekts ir pabeigts un tam vairs nav jātraucē sarakstā. Dati nekur nepazūd, bet projektu sarakstā filtra «rādīt arhīvu» nav: atgriezt projektu no arhīva var tikai portfeļa vadītājs. Pirms arhivēšanas saglabājiet saiti uz projektu.',
            'Veidne — sagatave līdzīgiem projektiem: darbu sadalījums un sadaļas saglabājas, bet konkrētā projekta dati — nē.',
            'Kopija — vesela projekta dublikāts, kad nākamo taisa «tāpat kā to, tikai citai nodaļai».',
          ],
        },
      ],
    },
    {
      id: 'look',
      title: 'Kā tas izskatās',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/projects.png', alt: 'Projektu saraksts ar filtriem' },
      ],
    },
  ],
}

export const portfolioPage: WikiPage = {
  slug: 'portfolio',
  title: 'Projektu portfolio',
  summary: 'Pārskats par visiem uzņēmuma projektiem. Redzams portfeļa vadītājam.',
  group: 'portal',
  appRoute: () => '/portfolio',
  sections: [
    {
      id: 'who',
      title: 'Kam pieejams',
      blocks: [
        { kind: 'p', text: 'Portfolio redz tikai portfeļa vadītājs. Projekta vadītājam šāda punkta izvēlnē nav — un tā tam arī jābūt: projekta vadītāja skats ir «Mani uzdevumi».' },
      ],
    },
    {
      id: 'what',
      title: 'Ko tas rāda',
      blocks: [
        { kind: 'p', text: 'Kopsavilkums par visiem projektiem uzreiz: cik aktīvu, cik nokavētu, kopējais budžets, portfeļa veselība. Zemāk — projektu kartītes, kuras var grupēt pēc klienta, programmas vai veida.' },
        { kind: 'p', text: 'Atsevišķi ir risku siltumkarte, cilvēku noslodze un tuvākie svarīgākie datumi — tas ir skatījums «kas deg uzņēmumā», nevis vienā projektā.' },
      ],
    },
  ],
}

export const profilePage: WikiPage = {
  slug: 'profile',
  title: 'Profils un divfaktoru autentifikācija',
  summary: 'Parole, 2FA, valoda un noformējums.',
  group: 'portal',
  appRoute: () => '/profile',
  sections: [
    {
      id: 'password',
      title: 'Parole',
      blocks: [
        { kind: 'p', text: 'Paroli, kuru izsniedza portfeļa vadītājs, ir vērts nomainīt: to zināt ne tikai jūs. Maiņa — sadaļā «Profils», būs jāapstiprina pašreizējā parole.' },
      ],
    },
    {
      id: 'twofa',
      title: 'Divfaktoru autentifikācija',
      blocks: [
        { kind: 'p', text: 'Pieteikšanās portālā notiek divos soļos: parole un sešciparu kods no autentifikatora lietotnes. Pieslēdz vienu reizi: portāls parāda QR kodu, jūs to noskenējat ar lietotni un ievadāt kodu pārbaudei.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Tas ir obligāti. Pieslēgšanai ir dažas dienas no pirmās pieteikšanās; kad termiņš beigsies, portāls pārstās rādīt datus un atstās tikai 2FA iestatīšanas logu. Ja nepaspējāt — vienkārši pieslēdziet to, un piekļuve atgriezīsies uzreiz.',
        },
        { kind: 'p', text: 'Pazaudējāt telefonu — palūdziet portfeļa vadītājam atiestatīt jūsu 2FA, lai to varētu pieslēgt no jauna.' },
      ],
    },
    {
      id: 'assistant',
      title: 'Palīga pieslēgšana',
      blocks: [
        { kind: 'p', text: 'Profila lejasdaļā ir adrese, ko ievieto savā ChatGPT vai Claude, poga «Kopēt» blakus tai un saraksts ar to, kas jau ir pieslēgts: kur tiek izmantots, kad izmantots pēdējo reizi un līdz kuram datumam ir derīgs.' },
        { kind: 'p', text: 'Atslēgt pieslēgumu var turpat ar vienu pogu — palīgs zaudē piekļuvi uzreiz. Atsevišķa rinda «Klients prasa ierakstīt pilnvaru ar roku» atklāj pilnvaras izsniegšanu: tā vajadzīga tikai tiem klientiem, kas neprot apstiprinājumu pārlūkā.' },
        { kind: 'p', text: 'Sīkāk par pieslēgšanu un par to, ko palīgs redz un ko neredz, — lapā «Kā pieslēgt palīgu».' },
      ],
    },
    {
      id: 'look-and-feel',
      title: 'Valoda un noformējums',
      blocks: [
        { kind: 'p', text: 'Saskarnes valodu (krievu, angļu, latviešu) pārslēdz kreisās izvēlnes apakšā, tur pat ir gaišā un tumšā tēma. Sadaļā «Profils» izvēlas noformējumu: silto Warm vai Classic.' },
      ],
    },
  ],
}

export const settingsPage: WikiPage = {
  slug: 'settings',
  title: 'Portāla iestatījumi',
  summary: 'Lietotāji, cilvēku katalogs, Bitrix24, veselības sliekšņi. Tikai portfeļa vadītājam.',
  group: 'portal',
  appRoute: () => '/settings',
  sections: [
    {
      id: 'who',
      title: 'Kam pieejams',
      blocks: [
        { kind: 'p', text: 'Sadaļa redzama tikai portfeļa vadītājam: te izveido piekļuves un iestata portālu kopumā.' },
      ],
    },
    {
      id: 'people',
      title: 'Cilvēki un lietotāji',
      blocks: [
        { kind: 'p', text: 'Cilvēku katalogs — visi darbinieki, ievilkti no Bitrix24. No tā izvēlas izpildītājus un dalībniekus. Ielādes poga atjaunina katalogu: pienāk jaunie darbinieki, telefoni un amati.' },
        { kind: 'p', text: 'Portāla lietotāji — tie, kas var pieteikties. Kontu var izveidot tieši no kataloga rindas: portāls ģenerēs paroli un parādīs to vienu reizi.' },
        { kind: 'note', tone: 'tip', text: 'Atzīme «Paslēpts» izņem tehniskos kontus no personu izvēles sarakstiem, lai tie netraucētu, piešķirot izpildītāju. Pašā katalogā cilvēks paliek.' },
      ],
    },
    {
      id: 'rest',
      title: 'Pārējais',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Bitrix24 — tīmekļa āķa adrese un savienojuma pārbaude.',
            'Veselības sliekšņi — pie cik augstiem riskiem un kavējumiem projekts kļūst sarkans.',
            'Problēmu ziņojumi — viss, kas atsūtīts ar pogu «Ziņot par problēmu», kopā ar ekrānuzņēmumiem.',
            'Sinhronizācijas žurnāls — kas un kad ir apmainīts ar Bitrix24.',
          ],
        },
      ],
    },
  ],
}

export const bitrixPage: WikiPage = {
  slug: 'bitrix',
  title: 'Saikne ar Bitrix24',
  summary: 'Uzdevumi, kalendārs un laika izvēle — bez dubulta darba.',
  group: 'portal',
  sections: [
    {
      id: 'tasks',
      title: 'Uzdevumi',
      blocks: [
        { kind: 'p', text: 'Uzdevumu no darba plāna var nosūtīt uz Bitrix24 — izpildītājam ierastāk strādāt tur, un dublēt to ar rokām nav vajadzības. Par izveidotāju kļūst projekta vadītājs, par atbildīgo — uzdevuma izpildītājs.' },
        { kind: 'p', text: 'Atpakaļ atgriežas statuss: aizvērāt uzdevumu Bitrix — portāls to pamanīs. Sinhronizācija sākas, atverot projektu, un ar pogu tā galvenē.' },
      ],
    },
    {
      id: 'calendar',
      title: 'Kalendārs un sanāksmes',
      blocks: [
        { kind: 'p', text: 'Sanāksme no portāla izveido notikumu Bitrix24 kalendārā un uzaicina dalībniekus. Dalībnieku aizņemtību portāls redz jau iepriekš — tāpēc prot piedāvāt laiku, kad visi ir brīvi.' },
        { kind: 'p', text: 'Portāla kalendārā Bitrix24 notikumus rāda virs uzdevumu termiņiem: redzams, ka darba laiks jau ir aizņemts.' },
      ],
    },
    {
      id: 'limits',
      title: 'Ko tas nedara',
      blocks: [
        { kind: 'p', text: 'Portāls nevelk no Bitrix24 svešus uzdevumus un to neaizstāj. Sinhronizējas tikai tas, ko nosūtāt jūs.' },
      ],
    },
  ],
}

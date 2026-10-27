import type { WikiPage } from '../types'

export const risksPage: WikiPage = {
  slug: 'risks',
  title: 'Risku reģistrs',
  summary: 'Kas var noiet greizi, cik tas ir bīstami un kurš tam seko līdzi.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/risks`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Risks ir tas, kas vēl nav noticis, bet var notikt. Pierakstītu risku pārrunā laikus; nepierakstīts agri vai vēlu pārvēršas par avārijas situāciju.' },
        { kind: 'p', text: 'Reģistram ir arī otrs uzdevums, kas atklājas nepatīkamā brīdī. Kad risks iestājas, saruna izvēršas vai nu «mēs to zinājām, un lūk, ko darījām», vai «kāpēc neviens par to nepadomāja». Starpība starp šīm divām sarunām ir trīs rindiņas, uzrakstītas mēnesi iepriekš.' },
        { kind: 'note', tone: 'tip', text: 'Trīs līdz pieci riski ir gluži pietiekami. Projekts bez neviena riska parasti nozīmē, ka par tiem vienkārši nav domāts, bet trīsdesmit riskus neviens nelasa.' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv risks',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Risks', 'Formulējums «ja — tad». «Apakšuzņēmējs» nav risks. «Apakšuzņēmējs laikā neuzsāks darbus objektā, un montāža nobīdīsies par mēnesi» — ir risks.'],
            ['Kategorija', 'Tehnisks, finansiāls, operacionāls, ārējs, personāls. Nevis atskaitei: kad četri riski no pieciem ir ārēji, redzams, ka projekts turas uz svešiem solījumiem.'],
            ['Varbūtība un ietekme', 'Katrai trīs pakāpes — augsta, vidēja, zema. No tām portāls izrēķina vērtējumu (skat. zemāk).'],
            ['Statuss', 'Atvērts, samazināts, pieņemts, slēgts, iestājies.'],
            ['Atbildīgais', 'Konkrēts cilvēks, nevis «komanda seko līdzi». Atbildīgais ir tas, kurš pamanīs pirmais un kuram ir sviras.'],
            ['Apraksts', 'Kas tieši notiks un pēc kādām pazīmēm būs skaidrs, ka tas ir sācies.'],
            ['Samazināšanas plāns', 'Ko darām IEPRIEKŠ, lai risks neiestātos.'],
            ['Rīcības plāns', 'Ko darām, JA tas tomēr ir iestājies.'],
          ],
        },
        { kind: 'p', text: 'Tabulā garie lauki tiek apgriezti pēc kolonnas platuma. Lai risku izlasītu un aizpildītu pilnībā, atveriet tā kartīti — zīmuļa poga rindas galā. Blakus poga atver vēsturi: kurš un kad mainīja vērtējumus. Pēc tās redzams, vai risks izdziest vai uzliesmo.' },
      ],
    },
    {
      id: 'score',
      title: 'Varbūtība, ietekme, vērtējums',
      blocks: [
        { kind: 'p', text: 'Augsta pakāpe ir 3, vidēja — 2, zema — 1. Riska vērtējums ir varbūtības un ietekmes reizinājums, no 1 līdz 9. Pēc tā rinda tiek iekrāsota: 7 un vairāk — sarkans, no 4 līdz 6 — dzeltens, 3 un mazāk — zaļš. Kārtošana pēc vērtējuma uzceļ augšā to, ar ko sanāksmē sāk.' },
        {
          kind: 'table',
          head: ['Varbūtība un ietekme', 'Vērtējums', 'Ko iesaka portāls'],
          rows: [
            ['Augsta un augsta', '9', 'Izvairīties: mainīt plānu tā, lai riska nebūtu vispār — cits apakšuzņēmējs, cita tehnoloģija, cits termiņš.'],
            ['Augsta un vidēja (vai otrādi)', '6', 'Izvairīties: iestāšanās maksā vairāk nekā plāna maiņa.'],
            ['Vidēja un vidēja; augsta un zema', '4 un 3', 'Samazināt: plānu atstājam, bet iepriekš mazinām varbūtību vai zaudējumu.'],
            ['Viss pārējais', '1–2', 'Pieņemt: turam redzeslokā, atsevišķas darbības nav vajadzīgas.'],
          ],
        },
        { kind: 'p', text: 'Kolonna «Darbība» šo ieteikumu parāda pati. Cilnes apakšā tie paši riski ir izklāti 3×3 matricā — pēc tās sekundē redzams, vai tie sakrājušies sarkanajā stūrī vai ir izkliedēti.' },
        { kind: 'note', tone: 'info', text: 'Portāla ieteikums nav pavēle. Mēdz gadīties, ka risku ar vērtējumu 9 apzināti pieņem, jo alternatīva maksā dārgāk. Tad tieši to arī raksta rīcības plānā — tas ir apzināts lēmums, nevis pārskatīšanās.' },
      ],
    },
    {
      id: 'plans',
      title: 'Divi plāni, nevis viens',
      blocks: [
        { kind: 'p', text: 'Samazināšanas plāns un rīcības plāns atbild uz dažādiem jautājumiem, un tos sajaukt ir biežākā kļūda reģistrā. «Katru nedēļu sazvanīties ar apakšuzņēmēju» ir samazināšana: mazina varbūtību. «Ja apakšuzņēmējs nokavē termiņu, montāžu veic sava brigāde, darbs 40 stundas» ir rīcības plāns: mazina zaudējumu, kad samazināšana nav nostrādājusi.' },
        { kind: 'note', tone: 'warn', text: 'Riskam ar vērtējumu 6 un vairāk plāns ir obligāts, citādi panelis «Šajā lapā» par to atgādinās katrā apmeklējumā. Un atgādina pamatoti: augsts risks bez plāna ir vienkārši pierakstīta trauksme.' },
        { kind: 'p', text: 'Labu plānu pārbauda ar vienu jautājumu: vai pēc tā ir skaidrs, kas jādara rīt no rīta, un vai atbildīgajam tam pietiek pilnvaru. «Turēt kontrolē» šo pārbaudi neiztur.' },
      ],
    },
    {
      id: 'rhythm',
      title: 'Darba ritms ar reģistru',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Pārskatīt reizi nedēļā vai pirms statusa atskaites: vērtējumi mainās līdz ar projektu, nevis paliek tādi, kādi bija startā.',
            'Jauni riski visbiežāk uzpeld sanāksmēs — pierakstiet uzreiz, kamēr formulējums ir svaigs.',
            'Risku, kas nav kustējies trīs mēnešus, vai nu pārceliet uz «Pieņemts», vai slēdziet. Reģistru no mirušām rindām pārstāj lasīt vispār.',
            'Iestājušos risku nedzēš: tam liek statusu «Iestājies», un darbs ar to kļūst par uzdevumu darbu plānā.',
          ],
        },
        { kind: 'p', text: 'Slēgtie un iestājušies riski paliek projektā ar nolūku. Nākamajā līdzīgajā projektā tas ir gatavs saraksts ar to, par ko padomāt laikus, — bet analīzē redzams, kuri vērtējumi bija tuvu patiesībai.' },
      ],
    },
    {
      id: 'look',
      title: 'Kā tas izskatās',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/risks.png', alt: 'Risku reģistrs ar varbūtības un ietekmes novērtējumiem' },
      ],
    },
  ],
}

export const decisionsPage: WikiPage = {
  slug: 'decisions',
  title: 'Lēmumu žurnāls',
  summary: 'Kas tika nolemts, kāpēc tieši tā un kurš to izlēma.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/decisions`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Visnenovērtētākā sadaļa. Pēc pusgada neviens vairs neatceras, kāpēc izvēlējās tieši šo variantu, un diskusija sākas no jauna. Divu rindiņu ieraksts ietaupa stundas.' },
        { kind: 'p', text: 'Pierakstiet ne tikai pašu lēmumu, bet arī pamatojumu: kādas bija alternatīvas un kāpēc izvēlējāties tieši šo. Pamatojums ir tas, kas ļauj lēmumu pārskatīt. Ja apstākļi mainījušies, redzams, kurš pieņēmums vairs nav spēkā; bez pamatojuma atliek tikai strīdēties no jauna.' },
        { kind: 'p', text: 'Otrs efekts atklājas, nododot projektu. Jaunais vadītājs izlasa lēmumu žurnālu un pusstundā saprot, kāpēc projekts ir iekārtots tieši šādi, — nevis nedēļu jautā «bet kāpēc jums te tā?».' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv ieraksts',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Lēmums', 'Vienā apgalvojuma rindā: «Pārejam pie apakšuzņēmēja X», «Pilotu sākam vienā noliktavā, nevis trijās».'],
            ['Datums', 'Kad tika nolemts, nevis kad ierakstīts.'],
            ['Kurš pieņēma', 'Cilvēks vai institūcija: «Projekta komiteja», «Sponsors». Tā nav vainīgā meklēšana, bet skaidrība, ar ko kopā iet pārskatīt.'],
            ['Statuss', 'Aktīvs, aizstāts, atsaukts.'],
            ['Apraksts', 'Konteksts: kas notika un kāpēc lēmums vispār bija vajadzīgs.'],
            ['Pamatojums', 'Kāpēc izvēlēts tieši tas. Ieraksta galvenais lauks.'],
            ['Alternatīvas', 'Kas vēl tika apsvērts un kāpēc neder. Bez tā pēc pusgada pie noraidītā varianta atgriezīsies kā pie «jaunas idejas».'],
            ['Ietekme', 'Uz ko lēmums ietekmēja: termiņiem, budžetu, apjomu, kāda darbu.'],
          ],
        },
        { kind: 'p', text: 'Ieraksta numuru (D-01, D-02 …) portāls piešķir pats — uz to ērti atsaukties statusa atskaitē un sanāksmē.' },
      ],
    },
    {
      id: 'statuses',
      title: 'Lēmumus nepārraksta',
      blocks: [
        { kind: 'p', text: 'Pārdomājāt — veidojiet jaunu lēmumu, bet vecajam lieciet «Aizstāts». Atcēlāt bez aizstāšanas — «Atsaukts». Labot pagājuša lēmuma tekstu nedrīkst: no žurnāla pazūd tieši tas, kā dēļ to ved, — kas tobrīd tika uzskatīts par pareizu un no kā tika izriets.' },
        { kind: 'p', text: 'No tā izriet vienkāršs lasīšanas princips: «Aktīvs» ir tas, pēc kā vadāmies šodien; «Aizstāts» un «Atsaukts» ir vēsture, ko neizpilda, bet ko noder pārlasīt pirms līdzīgas izšķiršanās.' },
      ],
    },
    {
      id: 'howto',
      title: 'Kā aizpildīt',
      blocks: [
        { kind: 'p', text: 'Aktīvam lēmumam ir vajadzīgs pamatojums un datums — citādi panelis «Šajā lapā» par to atgādinās. Rakstīt labāk tajā pašā dienā: pēc nedēļas paliek pats fakts, bet argumenti aizmirstas pirmie.' },
        { kind: 'p', text: 'Ne viss, kas pārrunāts, ir lēmums. Žurnālā nonāk tas, kas maina projekta virzienu: piegādātāja izvēle, apjoma samazināšana, termiņa pārcelšana, atteikšanās no funkcijas. «Vienojāmies sazvanīties ceturtdien» ir uzdevums no sanāksmes protokola, nevis lēmums.' },
        { kind: 'note', tone: 'info', text: 'Sanāksmē pieņemtie lēmumi nonāk šeit automātiski, kad sanāksmi finalizē — ar roku tos dublēt nevajag. Ja izveidosiet tādu lēmumu gan žurnālā, gan protokolā, iegūsiet divus vienādus ierakstus.' },
      ],
    },
  ],
}

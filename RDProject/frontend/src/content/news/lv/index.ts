import type { NewsItem } from '../types'

/** Sastāvu un secību nosaka krievu kopa (skat. content/news/ru). */
export const NEWS: NewsItem[] = [
  {
    id: '2026-10-28-access-hardening',
    date: '2026-10-28',
    title: 'Paroles maiņa atvieno arī palīgu',
    summary: 'Pēc paroles maiņas palīgs jāpieslēdz no jauna. Uzdevuma izveidotājs Bitrix24 vienmēr ir projekta vadītājs. Bitrix24 atlaists darbinieks pats zaudē pieteikšanos portālā.',
    blocks: [
      { kind: 'p', text: 'Trīs izmaiņas par piekļuvi. Katra novērš gadījumu, kad portāls uzskatīja piekļuvi par slēgtu, bet tā palika atvērta, — vai kad uzdevums nonāca pie cilvēkiem ne no tā, kurš to deva.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Jauna parole — jauna palīga pieslēgšana',
            text: 'Paroli maina, kad baidās, ka tā ir noplūdusi. Agrāk paroles maiņa beidza sesijas pārlūkā, bet palīga pieslēgums (Claude, ChatGPT) turpināja darboties līdz 90 dienām. Tagad tiek atsaukts arī tas. Pēc paroles maiņas pieslēdziet palīgu no jauna: konektors Claude vai ChatGPT palūgs vēlreiz apstiprināt piekļuvi, bet manuālo pilnvaru izsniedziet sadaļā «Profils → Palīga pieslēgšana». Tas pats notiek, ja paroli jums nomaina portfeļa vadītājs.',
          },
          {
            title: 'Izveidotājs Bitrix24 — projekta vadītājs',
            text: 'Logā «Izveidot uzdevumu Bitrix24» lauku «Izveidotājs» vairs nevar izvēlēties. Par to kļūst projekta vadītājs, bet, ja viņa nav Bitrix24, — jūs. Agrāk tur varēja norādīt jebkuru darbinieku, un uzdevums nonāca pie cilvēkiem «no viņa», lai gan viņš to nebija devis.',
          },
          {
            title: 'Atlaists darbinieks pats zaudē pieteikšanos',
            text: 'Kad darbinieku atslēdz Bitrix24, nakts cilvēku sinhronizācija izslēdz arī viņa pieteikšanos portālā un palīga pieslēgumus. Sadaļā «Iestatījumi → Lietotāji» šādam kontam ir atzīme «Atlaists (Bitrix24)». Ja piekļuve joprojām vajadzīga (apakšuzņēmējs, kļūda Bitrix24), portfeļa vadītājs atzīmē «Aktīvs» — un sinhronizācija šo kontu vairs neaiztiek.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Vairāk nekā trīs «atlaišanas» vienā naktī sinhronizācija nepiemēro: tā izskatās kļūme datu izgūšanā no Bitrix24, nevis cilvēku aiziešana. Tad nevienu neatslēdz, bet Bitrix24 sinhronizācijas žurnālā parādās ieraksts. Pēdējo aktīvo portfeļa vadītāju sinhronizācija neatslēdz nekad.',
      },
    ],
  },
  {
    id: '2026-10-28-assistant-sees-whole-project',
    date: '2026-10-28',
    title: 'Palīgs atvērtu projektu redz pilnībā — palīdzība to tagad saka tieši',
    summary: 'Atzīme «Atvērt projektu palīgam» atver visu projektu — kopā ar budžetu, lēmumiem un ieinteresēto pušu vērtējumiem. Palīdzība solīja otru atzīmi, kas naudu un cilvēku vērtējumus atstāj portālā, — tādas nav, teksts izlabots.',
    blocks: [
      { kind: 'p', text: 'Palīdzībā «Kā pieslēgt palīgu» bija rakstīts, ka atsevišķa atzīme nelaiž palīgu pie budžeta un ieinteresēto pušu vērtējumiem. Tādas atzīmes nav: «Atvērt projektu palīgam» atver projektu pilnībā, un viss, ko palīgs no tā izlasa, aiziet uz pakalpojumu, kuru izmantojat. Neaiziet tikai pievienoto failu saturs — palīgs redz vien to sarakstu. Palīdzība tagad to apraksta tā, kā ir.' },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Pārbaudiet, kuriem projektiem piekļuve ir atvērta: «Kopīgot» projekta galvenē → cilne «Asistents (MCP)». Atstājiet atvērtus tikai tos, kuru datus jūsu organizācijas politika ļauj nodot izvēlētajam MI pakalpojumam. Noņemta atzīme piekļuvi aizver uzreiz.',
      },
    ],
  },
  {
    id: '2026-09-30-honest-rag',
    date: '2026-09-30',
    title: 'Projekta krāsa kļuvusi godīgāka',
    summary: 'Sarkans — kad kavēta ceturtā daļa plāna vai ir augsts risks bez mazināšanas plāna. Godīgi reģistrēts risks ar plānu projektu vairs neiekrāso sarkanu.',
    blocks: [
      { kind: 'p', text: 'Līdz šim projekts kļuva sarkans no viena kavēta uzdevuma vai viena augsta riska. Šāda krāsa vairs neko nenozīmē: kad sarkans ir viss, nav redzams, kur patiešām deg.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Sarkans — kad laiks iejaukties',
            text: 'Kavēta vismaz ceturtā daļa darbu un vismaz trīs darbi. Vai ir atvērts augsts risks, kuram neviens nav pierakstījis mazināšanas plānu.',
          },
          {
            title: 'Dzeltens — kad vērts ieskatīties',
            text: 'Ir kaut viens kavēts darbs, kaut viens atvērts augsts risks vai atvērts vidējs risks.',
          },
          {
            title: 'Risks ar plānu ir vadība, nevis trauksme',
            text: 'Ja esat reģistrējis augstu risku un pierakstījis, ko ar to darīsiet, projekts tā dēļ vairs nekļūst sarkans. Lai sarkanais pazustu, pietiek aizpildīt riskam lauku «Mazināšanas plāns».',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Fāzes netiek skaitītas, atcelti uzdevumi netiek uzskatīti par kavētiem. Iepriekšējie portfeļa momentuzņēmumi nav pārrēķināti — vēsture palika tāda, kāda bija. Sīkāk un sliekšņi — palīdzībā, lapā «Kā tiek aprēķināti portfeļa rādītāji».',
      },
    ],
  },
  {
    id: '2026-09-16-full-text-on-hover',
    date: '2026-09-16',
    title: 'Garš teksts tabulās lasāms pilnībā — uzvediet kursoru uz šūnas',
    summary: 'Ja ieraksts neietilpst kolonnā, uzvedot kursoru atveras logs ar pilnu tekstu. Klikšķināt un labot šūnu var tāpat kā agrāk — logs peli nepārtver.',
    blocks: [
      { kind: 'p', text: 'Sadaļās, kur rindai nav savas kartītes — ieinteresētās puses, komanda, pieņēmumi, komunikācijas plāns, lēmumi, rādītāji, riski, — teksts tiek grieztas divās rindās. Izlasīt garu piezīmi nebija kur: paplašināsi kolonnu — saspiedīsies kaimiņi.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Uzvediet kursoru — un redzēsiet visu',
            text: 'Logs parādās aptuveni pēc trešdaļsekundes un tikai tur, kur teksts TIEŠĀM ir apgriezts. Ja ieraksts ietilpst pilnībā, nekas neuzpeld — tabula nemirgo, kamēr vienkārši vadāt peli.',
          },
          {
            title: 'Tas netraucē labot',
            text: 'Logs peli neķer: klikšķis iet tam cauri uz šūnu un atver to labošanai, tāpat kā agrāk. Tas bija galvenais nosacījums — lai nesanāktu «uzvedu kursoru un vairs nevaru labot».',
          },
          {
            title: 'Arī ar tastatūru',
            text: 'Pārgājāt uz šūnu ar tabulatoru — logs atveras uzreiz, bez aizkaves. Escape to aizver. Planšetē, kur kursora uzvedināšanas nav, logs netraucē.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Kolonnu platumu joprojām var vilkt ar peli, un logs to ņem vērā: tas skatās uz pašreizējo platumu uzvedināšanas brīdī, nevis uz to, kāds bija, atverot lapu.',
      },
    ],
  },
  {
    id: '2026-09-16-transfer-by-pm',
    date: '2026-09-16',
    title: 'Nodot projektu citam vadītājam tagad var pats projekta vadītājs',
    summary: 'Poga «Nodot projektu» projekta galvenē parādījusies projekta vadītājam — saviem projektiem. Tas, kurš nodod, paliek kā līdzvadītājs un piekļuvi nezaudē.',
    blocks: [
      { kind: 'p', text: 'Agrāk projektu citam cilvēkam varēja nodot tikai portfeļa vadītājs, un katra nodošana gāja caur viņu. Tagad savu projektu pārvalda tas, kurš to vada.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Kur ir poga',
            text: 'Projekta galvenē, vienā rindā ar «Darbību žurnāls» un «Dalīties» — «Nodot projektu» ar bultiņām. Izvēlnē «Vairāk» tās nav. Redzama tā saviem projektiem: tiem, kuru vadītājs esat jūs.',
          },
          {
            title: 'Jūs paliksiet kā līdzvadītājs',
            text: 'Projekts aizceļos pie izvēlētā cilvēka: viņš kļūs par īpašnieku un redzēs projektu savējos. Bet piekļuve jums saglabāsies — portāls pats pievienos jūs kā līdzvadītāju, lai nodošana nepārvērstos projekta zaudēšanā. Par to rakstīts arī pašā nodošanas logā.',
          },
          {
            title: 'Kas ir sarakstā',
            text: 'Tikai tie, kam ir portāla konts un tiesības vadīt projektus. Agrāk tur varēja nokļūt cilvēks no saraksta bez konta — un nodošana neizdevās.',
          },
          {
            title: 'Pasē — tas pats',
            text: 'Lauks «Projekta vadītājs» atkal maināms tieši pasē: savā projektā — jums, jebkurā — portfeļa vadītājam.',
          },
          {
            title: 'Veidojot projektu, vadītājs esat jūs',
            text: 'Lauks «Projekta vadītājs» jaunajā pasē kļuvis tikai lasāms — un tas ir labojums. Agrāk tur varēja ierakstīt kolēģi, bet projekts tik un tā tika pierakstīts tam, kurš to veido, un neviens par to nebrīdināja. Nododiet projektu uzreiz pēc izveides — ar pogu galvenē.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Projekta līdzvadītājs to nodot nevar: citādi viņš ieceltu galveno sevi un ieslēgtu īsto vadītāju. Nodot projektu drīkst tas, kuram tas pieder, un portfeļa vadītājs.',
      },
    ],
  },
  {
    id: '2026-09-16-cards-keep-your-work',
    date: '2026-09-16',
    title: 'Kartīte vairs neizmet ierakstīto',
    summary: 'Aizvērāt uzdevuma, backlog punkta vai riska kartīti — tā saglabā, nevis pazaudē. Teksta iezīmēšana ar peli to vairs neaizcērt. Punkta pārcelšana uz darbu plānu nepārtrauc saiti ar Bitrix24 uzdevumu.',
    blocks: [
      { kind: 'p', text: 'Aprakstu un plānus kartītē raksta minūtēm ilgi, bet uz serveri tie aizgāja tikai pēc pogas «Saglabāt». Viss, kas bija ierakstīts tai garām, pazuda klusi — un visbiežāk ne cilvēka kļūdas dēļ.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Aizvērt nozīmē saglabāt',
            text: 'Krustiņš, Escape un klikšķis uz aptumšojuma aiz kartītes tagad vispirms saglabā ierakstīto un tikai tad aizver. Ja serveris labojumu nepieņem, kartīte paliks atvērta — teksts būs jūsu priekšā, nevis pazudis. Nospiediet aizvēršanu vēlreiz — iziesiet bez saglabāšanas.',
          },
          {
            title: 'Teksta iezīmēšana ar peli vairs neaizcērt kartīti',
            text: 'Apvainojošākais zaudējums: jūs iezīmējāt garu aprakstu, atlaidāt pogu tieši aiz loga malas — un kartīte aizvērās kopā ar tekstu. Tā ir pārlūka uzbūve: klikšķi tas nodod kustības sākuma un beigu kopīgajai vietai, un tā izrādījās aptumšojums. Tagad kartīti aizver tikai nospiešana, kas sākta uz paša aptumšojuma.',
          },
          {
            title: 'Escape sadaļā «+ Pievienot cilvēku» atceļ tikai pievienošanu',
            text: 'Agrāk, ja pārdomājāt veidot jaunu cilvēku un nospiedāt Escape, aizvērās visa kartīte — kopā ar nesaglabāto.',
          },
          {
            title: 'Punkta pārcelšana uz darbu plānu saglabā Bitrix24 uzdevumu',
            text: 'Ja no backlog punkta jau bija izveidots uzdevums Bitrix24, tā numurs tagad pārceļas uz darbu plāna uzdevumu. Iepriekš saite pazuda, un portāls piedāvāja uzdevumu veidot no jauna — izpildītājs Bitrix saņēma otru tādu pašu.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Uz āru aiziet tikai tas, ko jūs tiešām aiztikāt. Pārējos laukus kartīte neraksta — kamēr tā ir atvērta, uzdevuma statusu varēja mainīt gan sinhronizācija ar Bitrix24, gan kolēģis.',
      },
    ],
  },
  {
    id: '2026-09-16-formatted-descriptions',
    date: '2026-09-16',
    title: 'Noformēts apraksts redzams uzreiz, un palīgs prot to noformēt',
    summary: 'Apraksts ar treknrakstu un sarakstiem atveras jau noformēts, bez zvaigznītēm. Darba plānā tas vairs nesaplok no nejauša klikšķa. Palīgam pastāstīja, ar ko drīkst noformēt un kur nedrīkst.',
    blocks: [
      { kind: 'p', text: 'Noformējumu aprakstā ieviesām pirms nedēļas, bet to redzēja tikai tas, kas nospieda «Priekšskatījums». Tieši to arī labojām.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Apraksts atveras noformēts',
            text: 'Ja tekstā ir treknraksts, saraksti vai apakšvirsraksts — jūs uzreiz redzat tos tādus, kādi tie ir, nevis «**svarīgi**». Vajag palabot — poga «Labot» ir blakus. Tukšs apraksts un teksts bez noformējuma joprojām atveras labošanas režīmā: tur nav ko skatīties.',
          },
          {
            title: 'Lasītājam vairs nerāda ievades lauku',
            text: 'Kam projekts ir tikai skatīšanai, tas redz gatavu tekstu, nevis bloķētu lauku ar noformējuma zīmēm.',
          },
          {
            title: 'Darba plāns vairs nebojā garus aprakstus',
            text: 'Tas bija kluss zaudējums, tāds pats, kādu pagājušajā reizē aizvērām backlog sadaļā: aprakstu tabulā laboja vienrindas lauks, bet tāds lauks pēc pārlūka uzbūves izgriež rindu pārnesumus. Pietika ieklikšķināt šūnā un aiziet garām — un teksts no vairākām rindkopām saplaka vienā rindā. Tagad klikšķis uz apraksta atver uzdevuma kartīti.',
          },
          {
            title: 'Palīgs zina, ar ko noformēt',
            text: 'Ārējam palīgam nodeva noteikumus: sešas portāla zīmes, nevis viss markdown. Saites, tabulas, pārsvītrotu tekstu un dziļākus virsrakstus viņš tagad neatnesīs — bet, ja atnesīs, portāls viņu par to brīdinās vēl pirms jūs ieraudzīsiet melnrakstu. Un viņš zina, ka noformēt drīkst tikai uzdevuma aprakstu un backlog punkta aprakstu: riskā, lēmumā un protokolā zīmes paliktu ekrānā uz visiem laikiem.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Tabulās, izvilkumos un Bitrix apraksts joprojām redzams bez noformējuma zīmēm — tur tām nav vietas. Pilns noformētais teksts dzīvo kartītē.',
      },
    ],
  },
  {
    id: '2026-09-16-backlog-card',
    date: '2026-09-16',
    title: 'Backlog punktam parādījās kartīte — tāda pati kā uzdevumam',
    summary: 'Punkta kods atver logu ar laukiem divās kolonnās un aprakstu savā cilnē. Tabulā aprakstu vairs nebojā vienrindas lauks.',
    blocks: [
      { kind: 'p', text: 'Backlog bija vienīgā sadaļa, kur garu tekstu nācās rakstīt pirksta platuma šūnā. Tagad punktam ir kartīte — tāda pati kā uzdevumam darba plānā.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Trīs veidi, kā atvērt',
            text: 'Nospiediet punkta kodu (B-01, B-02…) — tas tagad ir poga. Vai zīmuli, kas parādās pie nosaukuma, uzvedot peli. Vai pašu šūnu «Apraksts» — kartīte atvērsies uzreiz vajadzīgajā cilnē.',
          },
          {
            title: 'Apraksts vairs nezaudē rindkopas',
            text: 'Tas bija kluss zaudējums: tabulā aprakstu laboja vienrindas lauks, bet tāds lauks pēc pārlūka uzbūves izgriež rindu pārnesumus. Pietika ieklikšķināt šūnā un aiziet garām — un teksts no sapulces protokola saplaka vienā rindā. Tagad aprakstu labo tikai kartītē, visā loga izmērā, un tas prot treknrakstu, slīprakstu un sarakstus. Tabulā tas redzams īsi un bez noformējuma zīmēm.',
          },
          {
            title: 'Termiņi tiek rēķināti tāpat',
            text: 'Sākums, «dienas» un beigas kartītē ir saistītas ar to pašu aritmētiku, kas tabulā: no sākuma tiek aprēķinātas vai nu beigas, vai ilgums. Viens un tas pats ievads dod vienu un to pašu rezultātu, lai kur jūs to ierakstītu.',
          },
          {
            title: 'Atbildīgais beidzot saglabājas pilnībā',
            text: 'Cilvēka izvēle no saraksta aizgāja uz serveri divreiz, un otrā reize dzēsa saiti ar darbinieka kartīti — palika tikai vārds. Tādēļ «Pārnest uz darba plānu» klusi zaudēja izpildītāju. Salabots gan kartītē, gan tabulā.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Kartīte atveras arī režīmā «tikai skatīt»: agrāk novērotājs punkta detaļas nevarēja apskatīt vispār. Pārnešana uz darba plānu, dzēšana un Bitrix24 uzdevuma izveide palika tabulas rindā.',
      },
    ],
  },
  {
    id: '2026-09-15-assistant-dates',
    date: '2026-09-15',
    title: 'Palīgs vairs nesabojā blakus uzdevumu termiņus, un saites prot noņemt',
    summary: 'Datumi, ko palīgs piedāvāja, paliek tādi, kādus jūs tos pieņēmāt. Saites noņemšana beidzot strādā, bet pa ķēdi pārbīdītie uzdevumi ir uzskaitīti atskaitē.',
    blocks: [
      { kind: 'p', text: 'Trīs kļūmes, atrastas lielā plāna pārnesē: visas trīs par to, ka pēc «Pieņemt» projektā nonāca nevis tas, kas bija melnrakstā.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Melnraksta termiņi vairs netiek pārrakstīti',
            text: 'Kad uzdevumam mainās termiņš, portāls par tikpat pārbīda tā sekotājus — tā ir automātiskā plānošana, un parasti tai ir taisnība. Bet, ja palīgs uzreiz desmitiem uzdevumu noteica datumus, viena uzdevuma pārbīde uzgūlās virsū datumam, ko tas pats melnraksts skaidri bija noteicis citam. Lielā pārnesē tā varēja izjukt ievērojama daļa uzdevumu, daži — pat aiz projekta beigām. Tagad noteikums ir vienkāršs: to, ko melnraksts noteicis skaidri, kaskāde neaiztiek.',
          },
          {
            title: 'Kas pārbīdījās līdzi — redzams sarakstā',
            text: 'Piemērošanas atskaitē parādījās sadaļa «Pārbīdīts pa saitēm»: uzdevumi, kuru melnrakstā nebija, bet kuriem termiņi mainījās līdzi priekštečiem — ar jaunajiem datumiem. Agrāk to varēja uzzināt, tikai salīdzinot darba plānu rindu pa rindai.',
          },
          {
            title: 'Saites tiek noņemtas',
            text: 'Palīgs piedāvāja «noņemt atkarību», portāls atbildēja «pieņemts» — un saite palika vietā. Tagad tiek noņemta. Turklāt kļuva iespējams vienā melnrakstā apmainīt saites virzienu: serveris noņem vecās saites agrāk, nekā pievieno jaunās, citādi jauno atsita kā apli.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Piemērošanas atskaite atveras pa saiti uz melnrakstu izvēlnē «Palīgs» — tur arī viss dzēstais nosaukts vārdā.',
      },
    ],
  },
  {
    id: '2026-09-15-task-card',
    date: '2026-09-15',
    title: 'Uzdevuma kartīte kļuva platāka, bet apraksts — savā cilnē un ar noformējumu',
    summary: 'Uzdevuma logs paplašinājās, lauki sakārtojās divās kolonnās, apraksts pārcēlās uz atsevišķu cilni un iemācījās treknrakstu, slīprakstu un sarakstus.',
    blocks: [
      { kind: 'p', text: 'Uzdevuma kartīti atver visbiežāk, un tajā gandrīz nekas neietilpa. Tagad ietilpst.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Logs lielāks, lauki divās kolonnās',
            text: 'Bija 672 pikseļi un viena kolonna: puse formas aizgāja aiz apakšējās malas, un pogu «Saglabāt» nācās meklēt ar ritināšanu. Kļuva 1024 un divas kolonnas — forma redzama pilnībā uz klēpjdatora.',
          },
          {
            title: 'Apraksts — atsevišķa cilne',
            text: 'Agrāk tas bija priekšpēdējais lauks četrās rindās, un garu tekstu lasīja pa šauru spraugu. Tagad tam ir sava cilne visā loga izmērā.',
          },
          {
            title: 'Teksta noformējums',
            text: 'Virs lauka parādījās pogas: treknraksts, slīpraksts, vienplatuma, apakšvirsraksts, saraksts un numurēts saraksts. Blakus «Priekšskatījums» — apskatīt, kā sanāks. Strādā arī no tastatūras: **treknraksts**, *slīpraksts*, «- » rindas sākumā sarakstam.',
          },
          {
            title: 'Rindu pārnesumi beidzot saglabājas',
            text: 'Tas bija galvenais zaudējums: rindkopas aprakstā saplaka vienā rindā. Tagad teksts izskatās tā, kā to ierakstīja.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Darba plāna tabulā apraksts joprojām redzams īsi un bez noformējuma zīmēm — tur tām nav vietas. Pilns teksts ar noformējumu — kartītē. Uz Bitrix apraksts aiziet bez zīmēm: tur ir sava iezīmēšana.',
      },
    ],
  },
  {
    id: '2026-09-15-tabs-nav-colors',
    date: '2026-09-15',
    title: 'Jauna cilne vairs neprasa pieteikšanos, bet izvēlne un Darba plāns kļuvuši saprotamāki',
    summary: 'Portāls atveras jebkurā cilnē bez atkārtotas pieteikšanās. Klikšķis uz kategorijas uzreiz atver tās pirmo sadaļu, izvēlnes punkti izbrauc, bet tumšajā tēmā salasāmas prioritātes.',
    blocks: [
      { kind: 'p', text: 'Četri labojumi pēc jūsu piezīmēm — visi par to, kas traucēja katru dienu.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Pieteikšanās tiek atcerēta visam pārlūkam',
            text: 'Saite no čata, grāmatzīme, jauns logs, cilne pēc pārlūka pārstartēšanas — portāls vairs neprasa paroli no jauna. Agrāk katra šāda cilne portālam bija atsevišķa sesija, bet ar divfaktoru autentifikāciju tas nozīmēja arī kodu, un vairāki mēģinājumi pēc kārtas atdūrās pret aizsardzību. Sesija joprojām dzīvo 8 stundas; «Iziet» vienā cilnē tagad izslēdz visās uzreiz.',
          },
          {
            title: 'Kategorija atver savu sadaļu',
            text: 'Klikšķis uz «Plānošana» vai «Kontrole» uzreiz atver šīs kategorijas pirmo sadaļu. Agrāk mainījās tikai punktu lente, bet ekrānā palika iepriekšējā lapa — izskatījās, ka poga nenostrādāja. Ja jau esat kategorijas iekšienē, portāls nekur neaizved.',
          },
          {
            title: 'Redzams, ka punkti nomainījušies',
            text: 'Pārejot starp kategorijām, izvēlnes punkti īsi izbrauc no sāna. Ja sistēmā ieslēgts «samazināt kustību», animācijas nebūs.',
          },
          {
            title: 'Krāsas Darba plānā',
            text: 'Tumšajā tēmā prioritātes un statusi ieguva savus toņus: «Kritisks» vairs nepazūd fonā. Fāzes rinda tagad atšķiras ar toni no uzdevumu rindām zem tās — darba blokus redz uzreiz. Atceltie uzdevumi kļuva pelēki: tie nav «slikti», bet noņemti.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Ja strādājat pie koplietošanas datora, neaizmirstiet nospiest «Iziet» — tagad sesija pārdzīvo pārlūka aizvēršanu.',
      },
    ],
  },
  {
    id: '2026-09-14-milestones-from-plan',
    date: '2026-09-14',
    title: 'Atskaites punkti pasē nāk no Darba plāna un tiek atzīmēti kā izpildīti',
    summary: 'Bloks «Galvenie atskaites punkti» rāda Darba plāna fāzes, bet, ja fāžu nav, — uzdevumus. Paveiktais tiek atzīmēts ar ķeksīti.',
    blocks: [
      { kind: 'p', text: 'Agrāk šis bloks varēja rādīt trīs dažādas lietas, un cilvēks nesaprata, no kurienes tās nāk. Tagad noteikums ir viens visiem projektiem.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Viens noteikums',
            text: 'Darba plānā ir fāzes — atskaites punkti ir fāzes. Fāžu nav — tie ir augšējā līmeņa uzdevumi. Apakšuzdevumi netiek rādīti: tā ir darba detalizācija, nevis atskaites punkti. Saraksta, kas pasē ievadīts ar tekstu, vairs nav — tas atšķīrās no plāna: vienam projektam tas pats punkts tekstā bija 1. jūlijā, bet uzdevumā 30. septembrī.',
          },
          {
            title: 'Atzīme «izpildīts» — pēc statusa',
            text: 'Uzlikāt uzdevumam statusu «Izpildīts» Darba plānā — tas ir atzīmēts ar ķeksīti arī pasē. Izpildes procents nepiedalās: līdz pusei paveikts atskaites punkts nav iestājies. Tāpat tiek rēķināts arī projekta progress Portfelī — noteikums tagad ir viens.',
          },
          {
            title: 'Fāze aizveras pati',
            text: 'Ķeksītis pie fāzes parādās, kad aizvērti visi tās uzdevumi, — pat ja pašu fāzes rindu aizvērt aizmirsa. Atceltie uzdevumi fāzi aizvērt netraucē, bet atceltie punkti tiek atzīmēti ar vārdu «Atcelts», lai tos nelasītu kā paveiktus.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Ja blokā ir tukšs — Darba plānā pagaidām nekā nav. Izveidojiet fāzes vai uzdevumus: pase rāda plānu, nevis atsevišķu sarakstu.',
      },
    ],
  },
  {
    id: '2026-09-12-tree-polish',
    date: '2026-09-12',
    title: 'Programma un tās moduļi: projektu koka pabeigšana',
    summary: 'Portfelī apakšprojekti stāv zem sava lietussarga, cilnē «Apakšprojekti» parādījās analīze un poga «Izveidot apakšprojektu», bet brīdinājumi vairs nebiedē velti.',
    blocks: [
      { kind: 'p', text: 'Saite «projekts projektā» strādāja, bet malās bija raupji. Savācām visu, kas nebija pabeigts.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Portfelis rāda koku',
            text: 'Apakšprojekti stāv zem sava lietussarga ar atkāpi un bultiņu «↳», lietussargam — atzīme «Lietussargs · N». Ja starp tā moduļiem ir sarkanie, blakus deg to skaits: programma ar daudziem moduļiem vairs nav izmētāta sarakstā kopā ar svešiem projektiem. Kārtošana pēc kolonnas strādā kā agrāk — bet līmeņa ietvaros.',
          },
          {
            title: 'Cilne «Apakšprojekti» atveras',
            text: 'Moduļa rinda atveras ar to pašu analīzi «Kas ar projektu», kas Portfelī: kavējumi, riski, pārtēriņš un kas prasa uzmanību nedēļā. Agrāk cilne rādīja tikai ciparus, un uz jautājumu «kāpēc šis modulis sarkans» nācās atvērt projektu. Turpat poga «Izveidot apakšprojektu» — jaunais projekts uzreiz tiek piesaistīts lietussargam.',
          },
          {
            title: 'Brīdinājumi runā patiesību',
            text: 'Lietussarga arhivēšana tagad godīgi raksta, ka apakšprojektus tas neskars, bet dzēšana — ka tie netiks dzēsti, bet kļūs patstāvīgi. Izveidot veidni no lietussarga vai apakšprojekta portāls vairs neļauj: veidne paslēpjas no sarakstiem, un programma pazustu kopā ar dzīviem moduļiem.',
          },
          {
            title: 'Cilne neduras acīs',
            text: 'Parastam projektam, kur apakšprojektu nav un piesaistīt tos nav kam, cilne «Apakšprojekti» vairs netiek rādīta.',
          },
          {
            title: 'Uzņēmuma vadība var labot savus projektus',
            text: 'Lomai «uzņēmuma vadība» savs projekts atvērās tikai lasīšanai: pogas bloķētas, lai gan serveris rakstīšanu atļāva. Tagad ekrāns sakrīt ar tiesībām.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Datumu filtri Atlikumā pārgāja uz portāla kopīgo datuma lauku — formāts «dd.mm.gggg» ir vienāds visur, neatkarīgi no pārlūka valodas.',
      },
    ],
  },
  {
    id: '2026-09-11-personal-bell',
    date: '2026-09-11',
    title: 'Zvaniņš kļuva personisks',
    summary: 'Paziņojumi pienāk par projektiem, kurus vadāt, un par visu, kas uzdots jums. Svešais vairs nepil.',
    blocks: [
      { kind: 'p', text: 'Paziņojumu tvērums sakrita ar tiesībām lasīt. Projekta vadītājam tas ir viens un tas pats, bet portfeļa īpašniekam un uzņēmuma vadībai — tie redz visus projektus — krita par katru uzdevumu katrā projektā: starp simtiem svešu rindu savas nebija atrodamas. Novērotājam tāpat pila par projektu, kuru viņš vienkārši skatās.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Vadāt projektu — zvaniņš par to ir jūsu',
            text: 'Projekta vadītājs un līdzvadītājs joprojām redz visu: kavējumus, uzdevumus bez datumiem, sastingumu, tuvākās sanāksmes un uzdevumus. Lietussarga vadītājs redz arī savus apakšprojektus — tā ir tā pati koka saite.',
          },
          {
            title: 'Nevadāt — tikai savu',
            text: 'Svešā projektā jums parādīs uzdevumu, kas uzdots jums (arī kā līdzizpildītājam), sanāksmi, kurā esat dalībnieks, un uzdevumu, kas pierakstīts jums. Pārējais nav jūsu rūpe.',
          },
          {
            title: 'Starpprojektu griezums nekur nav pazudis',
            text: 'To sauc par Portfeli: tur redzami visi projekti uzreiz, ar sarkanajiem un dzeltenajiem. Zvaniņš atbild uz citu jautājumu — «kas vajadzīgs no MANIS», un atbildēt uz to ar svešu darbu sarakstu ir bezjēdzīgi.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Piekļuves pieprasījumi pienāk tam, kas vada projektu; atbilde uz jūsu pieprasījumu un ziņa «problēma atrisināta» — jums. Tas nav mainījies.',
      },
    ],
  },
  {
    id: '2026-09-11-co-assignees-kpi',
    date: '2026-09-11',
    title: 'Līdzizpildītāji uzdevumos un metrikas mērķa vērtība',
    summary: 'Uzdevumam parādījās līdzizpildītāju saraksts — uzdevums tiem redzams sadaļā «Mani uzdevumi». Bet metrikai tagad redzams mērķis, fakts un mērvienība.',
    blocks: [
      { kind: 'p', text: 'Abi uzlabojumi — pēc jūsu lūgumiem no «Ziņot par problēmu».' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Līdzizpildītāji',
            text: 'Darba plānā parādījās kolonna «Līdzizpildītāji»: nospiediet uz tās pie vajadzīgā uzdevuma un pievienojiet cilvēkus no saraksta. Uzdevums parādīsies tiem sadaļā «Mani uzdevumi» — ar parakstu, kāds tas ir punkts.',
          },
          {
            title: 'Kāpēc nevis «vairāki izpildītāji»',
            text: 'Par uzdevumu joprojām atbild VIENS cilvēks — kolonna «Izpildītājs». Kad atbildīgo ir vairāki, praksē neatbild neviens, un prasīt nav no kā. Līdzizpildītāji ir tie, kas piedalās darbā. Noslodzi Portfelī tie nesaņem: citādi vienas un tās pašas stundas tiktu saskaitītas visiem uzreiz un «pārslodze» iedegtos pusei uzņēmuma.',
          },
          {
            title: 'Mērķis un fakts metrikai',
            text: 'Sadaļā «Panākumu metrikas» parādījās kolonnas «Mērķis», «Fakts» un «Mērv.». Portāls tos glabāja arī agrāk — tos aizpilda imports no Excel un palīgs, — bet tabulā nerādīja, un metrikas statuss bija jāliek uz aci. Tagad redzams, uz ko ejam un kur atrodamies.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Ja cilvēka nav sarakstā, viņu var ierakstīt ar tekstu — bet portāls to atzīmēs un nevarēs šādam «līdzizpildītājam» parādīt uzdevumu: tas nezina, kas viņš ir. Labāk vispirms izveidot cilvēku Cilvēku sarakstā.',
      },
    ],
  },
  {
    id: '2026-09-11-user-reports',
    date: '2026-09-11',
    title: 'Salabots pēc jūsu ziņojumiem',
    summary: 'Fāžu datumi, notīrīšanas poga kalendārā, rindu secība, riska lauki, datumu formāts vednī. Un tagad portāls atbild: par lēmumu piekļuves pieprasījumā un par to, ka jūsu problēma atrisināta.',
    blocks: [
      { kind: 'p', text: 'Viss no tā atnāca caur «Ziņot par problēmu» vai čatā. Paldies — bez jūsu ziņojumiem pusi no tā nebūtu iespējams atrast.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Fāzēm netika ierakstīti datumi',
            text: 'Darba plānā fāzei varēja ievadīt «Sākums» un «Beigas», bet lauks palika tukšs — serveris fāžu datumus klusi izmeta. Uzdevumiem tādas bēdas nebija. Tagad fāze glabā savus plānotos datumus; progress tai joprojām tiek rēķināts no ietvertajiem uzdevumiem.',
          },
          {
            title: 'Poga «Notīrīt» kalendārā',
            text: 'Kalendārs darba plānā atvērās tukšs un uz tekošā mēneša, pat ja šūnā jau bija datums, — tāpēc «Notīrīt» neko nedarīja, bet mēnešu bultiņas uzvedās dīvaini. Tagad kalendārs atveras uz vajadzīgā mēneša, notīrīšana strādā, bet izvēlētais datums saglabājas, kad aizejat no lauka.',
          },
          {
            title: 'Rindas nevarēja pārvietot augstāk/zemāk',
            text: 'Viens klikšķis uz kolonnas virsraksta ieslēdza kārtošanu un UZ VISIEM LAIKIEM izslēdza manuālo secību: trešā stāvokļa nebija, bet izvēle saglabājās starp sesijām. Tagad trešais klikšķis noņem kārtošanu un atgriež vilkšanu. Tas ir visās tabulās, ne tikai Komunikācijas plānā.',
          },
          {
            title: 'Riska lauki pirms rindas saglabāšanas',
            text: 'Jaunajā risku reģistra rindā «Apraksts», «Mazināšanas plāns» un «Plāns iestāšanās gadījumam» bija tukšas šūnas — aizpildīt tos varēja tikai pēc saglabāšanas. Tagad tie ir pieejami uzreiz.',
          },
          {
            title: 'Datumu formāts projekta izveides vednī',
            text: 'Ātrajā projekta izveidē datumus zīmēja pārlūks, un daļai cilvēku tie izskatījās kā MM/DD/YYYY, lai gan visā pārējā portālā — dd.mm.gggg. Tagad lauks tur ir tāds pats kā visur. Pirmo nedēļas dienu pašā kalendārā pagaidām nosaka pārlūks — tas ir atsevišķs darbs.',
          },
          {
            title: 'Portāls sāka atbildēt',
            text: 'Piekļuves pieprasījums vairs neaiziet klusumā: apstiprināja vai noraidīja — jūs to redzēsiet paziņojumos kopā ar to, kurš izlēma. Bet, kad mēs labojam to, par ko jūs uzrakstījāt caur «Ziņot par problēmu», jums pienāk paziņojums «problēma atrisināta» ar īsu piezīmi, kas izdarīts.',
          },
          {
            title: 'Kam pienāk piekļuves pieprasījums',
            text: 'Pieprasījumu redz projekta vadītājs un viņa līdzvadītāji — tie, kas šo projektu vada. Portfeļa vadītājam tas vairs nepienāk par visiem svešajiem projektiem (izlemt viņš joprojām var, ja palūgs). Un pats pieprasījums nebeidzas: tas gaida lēmumu, cik vajag, bet divi mēneši — tā ir pauze pēc atteikuma, nevis lūguma dzīves ilgums.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Ja jūsu posmi bija ievadīti pasē ar roku, bet fāžu Darba plānā vēl nav — sadaļa «Galvenie atskaites punkti» tos atkal rāda. Agrāk tā teica «tukšs», lai gan dati nekur nepazuda.',
      },
    ],
  },
  {
    id: '2026-09-11-tidy-up',
    date: '2026-09-11',
    title: 'Mani uzdevumi kļuvuši saprotamāki, budžets — caurskatāmāks',
    summary: 'Sadaļā «Mani uzdevumi» redzams, kāds punkts ir priekšā un kura projekta tas ir. Portfelī — cik programmas budžeta izgājis caur apakšprojektiem. Budžeta izgūšanā parādījušās stundas.',
    blocks: [
      { kind: 'p', text: 'Nelielu labojumu kopums pēc aizrādījumiem: katrs pats par sevi neliels, bet kopā tie ir par vienu — lai pēc ekrāna būtu saprotams, kas uz tā rakstīts.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Mani uzdevumi: redzams, kāds ir punkts',
            text: 'Katrai rindai tagad ir pierakstīts tips: «Uzdevums», «Risks», «Lēmums», «Ieinteresētā puse». Agrāk bija tikai krāsaina ikona, un ieinteresētās puses rinda lasījās kā paša vārds un bildīte — kāds tas ir punkts, saprast nevarēja. Turklāt izlīdzinājās kolonnas: garš projekta kods vairs nenobīda blakus rindu nosaukumus, bet vadītāja vārds ir uzreiz aiz projekta nosaukuma, nevis pie labās malas.',
          },
          {
            title: 'Portfelis: kas izgājis caur apakšprojektiem',
            text: 'Kopprojekta rindai zem fakta parādījās paraksts «caur apakšprojektiem (N): summa» — cik tā bloku izlietojuši moduļi. Portfeļa kopsummās šis skaitlis neietilpst: citādi moduļa nauda tiktu saskaitīta divreiz — tam pašam un programmai.',
          },
          {
            title: 'Budžets: stundas izgūšanā un mājiens',
            text: 'Ja projektam norādīta stundas likme, Excel izgūšana saņem kolonnu «Stundas (plāns)» un rindu «Stundas (fakts)» pa mēnešiem — redzams, no kā izveidojusies summa, kad salīdzināt ar izpildītāja aktu. Bet tukšā mēneša plāna naudas šūnā pelēkā krāsā parādīts, cik dotu jau ievadītās stundas.',
          },
          {
            title: 'Filtri un kolonnu iestatīšana',
            text: 'Backloga filtri pēc datumiem ir salikti divos saprotamos rāmjos «Sākums» un «Beigas» četru atsevišķu lauku vietā. Kolonnu iestatīšanas poga visās lapās pārcēlusies pie labās malas — tā nav sadaļas virsraksta daļa. Ziņu lapa un palīdzība tagad ir ekrāna centrā.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-09-11-consolidated-budget',
    date: '2026-09-11',
    title: 'Kopbudžets: stundas, likme un bloku atlikums',
    summary: 'Kopprojektam parādījās budžets pa blokiem: plāns stundās × likme, bet izlietotais tiek vilkts no apakšprojektiem. Redzams, cik atlicis katrā blokā.',
    blocks: [
      { kind: 'p', text: 'Kad izpildītājs atskaitās stundās pa blokiem («40 stundas blokam X mēnesī»), bet blokus vada dažādi vadītāji, bloka atlikums bija jāsavāc ar rokām no daudzām cilnēm. Līdz savākšanas brīdim skaitļi paspēja novecot. Tagad portāls to izrēķina pats.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Stundas likme',
            text: 'Kopprojekta sadaļā «Budžets» parādījās rinda «Stundas likme». Apakšprojekti to manto — tiem tā ir redzama, bet nav labojama. Budžeta postenim ir lauks «Stundas (plāns)»: ierakstiet 800 stundas ar likmi 50, un portāls ieliks summu 40 000. Ierakstīsiet summu ar roku — tā būs svarīgāka par aprēķinu.',
          },
          {
            title: 'Fakts stundās',
            text: 'Mēneša plānā ar norādītu likmi parādījās trešā rinda — «Stundas (fakts)». Ierakstījāt 120 stundas augustā — portāls izrēķināja 6 000. Svarīga īpašība: stundas pārvēršas naudā ievadīšanas brīdī. Paaugstināsiet likmi jūlijā — janvāris paliks aprēķināts pēc janvāra likmes, un statusa atskaites nesašķirsies ar budžetu.',
          },
          {
            title: 'Attiecināt izdevumus uz bloku',
            text: 'Apakšprojekta budžetā parādījās bloks «Attiecināt izdevumus uz kopprojekta blokiem»: katram savam postenim izvēlaties, uz kuru bloku tas attiecas, un uzreiz redzat tā atlikumu. Jūsu summas paliek jūsu — savā ekrānā apakšprojekts joprojām redz savu plānu un faktu pilnībā.',
          },
          {
            title: 'Kopprojekta aina',
            text: 'Kopprojekta budžetā ir tabula «Sadalījums pa apakšprojektiem»: katram blokam plāns, savs fakts, cik paņēmis katrs apakšprojekts, izlietots kopā un atlikums. Mīnuss atlikumā izcelts sarkanā — tas ir signāls izpildītājam.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Nekas nepazūd klusējot. Apakšprojektu izdevumi ārpus blokiem ir uzskaitīti atsevišķā rindā, bet, ja bloks kopprojektā ir dzēsts, uz to attiecinātie izdevumi nepazūd — portāls tos parāda ar brīdinājumu un lūdz piesaistīt no jauna. Dažādas valūtas kokā portāls nesaskaita: pārrēķina tajā nav, tāpēc tas godīgi brīdina.',
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Vienlaikus izlabots grafiks «Budžets: uzkrājoši pa mēnešiem». Tas 2026. gada janvāri un 2027. gada janvāri skaitīja kā vienu punktu — gads ierakstā vispār netika lasīts. Projektos, kas garāki par gadu, grafiks rādīja divreiz mazāk punktu, un tās bija dažādu gadu summas.',
      },
    ],
  },
  {
    id: '2026-09-10-backlog-filters',
    date: '2026-09-10',
    title: 'Backlog: filtri pēc datumiem un darba statusi',
    summary: 'Backlogā parādījās filtri pēc sākuma un beigu datumiem, bet statusiem pievienoti «Plānošanā», «Darbā» un «Izpildīts».',
    blocks: [
      { kind: 'p', text: 'Backlogs auga, bet atlasīt tajā gandrīz nebija ko: viens filtrs pēc statusa, un arī tas rādīja tikai pusi vērtību. Tagad filtru ir vairāk, bet statusu saraksts — viens uz visu sadaļu.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Filtrs pēc datumiem',
            text: 'Virs tabulas ir divi lauku pāri: «Sākums: no — līdz» un «Beigas: no — līdz». Robežas ir ieskaitot un tiek uzstādītas neatkarīgi: var jautāt «kas sākas martā» vai «kam jābeidzas līdz aprīlim». Blakus parādās «Atiestatīt», bet skaitītājs rāda divus skaitļus — cik redzams no cik.',
          },
          {
            title: 'Jauni statusi',
            text: 'Pie «Jauns», «Izskatīšanā», «Apstiprināts» pievienoti «Plānošanā», «Darbā» un «Izpildīts» — punktu var vadīt tieši backlogā, nepārnesot to darba plānā. Secība sarakstā tagad atbilst darba gaitai, nevis ir sajaukta.',
          },
          {
            title: 'Viens statusu saraksts divu vietā',
            text: 'Agrāk tabulas šūnā varēja UZSTĀDĪT «Darbā», bet izvēlēties to, veidojot rindu, vai atrast ar filtru — nevarēja: vērtību saraksts dzīvoja divās vietās un izšķīrās. Tagad tas ir viens, un visi statusi ir pieejami visur vienādi.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Punkts bez datuma noteiktajā intervālā neiekļaujas: ja jautājāt «kas sākas martā», rinda bez sākuma datuma uz šo jautājumu neatbild. Tāpēc skaitītājs rāda «cik no cik» — rindas nav pazudušas, tās vienkārši ir ārpus intervāla.',
      },
    ],
  },
  {
    id: '2026-09-10-access-requests',
    date: '2026-09-10',
    title: 'Pieprasīt piekļuvi projektam — tieši no «Mani uzdevumi»',
    summary: 'Redzams, kurš ir projekta vadītājs, un viņam var palūgt piekļuvi skatīšanai. Pieprasījums nonāk viņa paziņojumos, kur to izlemj ar vienu pogu.',
    blocks: [
      { kind: 'p', text: 'Sadaļā «Mani uzdevumi» ir savākti jūsu uzdevumi no visiem projektiem — arī no tiem, kuros esat tikai dalībnieks un iekšā ieiet nevarat. Agrāk tur bija tikai slēdzene: kam pieder projekts un kam lūgt piekļuvi, portāls neteica, un vadītājs bija jāmeklē čatā.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Redzams, kurš ir vadītājs',
            text: 'Blakus slēgtam projektam tagad ir rakstīts tā vadītāja vārds — tā, kurš lemj, vai jūs ielaist.',
          },
          {
            title: 'Palūgt piekļuvi',
            text: 'Turpat ir poga «Pieprasīt piekļuvi». Var īsi uzrakstīt, kāpēc tā jums vajadzīga: bez iemesla vadītājam nav ko lemt. Piekļuvi pieprasa skatīšanai — kā novērotājam, labot neko nevarēsiet.',
          },
          {
            title: 'Vadītājs lemj paziņojumos',
            text: 'Pieprasījums nonāk projekta vadītāja zvaniņā un blokā «Nepieciešama uzmanība» Portfelī. Nospiežot atveras forma: kas lūdz, kuram projektam, ko saņems un kāpēc — un divas pogas, «Apstiprināt» un «Noraidīt». Apstiprinājums uzreiz pievieno cilvēku kā novērotāju.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Kamēr pieprasījums gaida lēmumu, pogas vietā ir atzīme «Pieprasījums nosūtīts» — lūgt divreiz nevajag. Ja atteica, atkārtot lūgumu var pēc diennakts. Pieprasījumu izlemj projekta vadītājs un portfeļa vadītājs; līdzvadītāji — nē, tāpat kā viņi arī manuāli nepiešķir novērotājus.',
      },
    ],
  },
  {
    id: '2026-09-10-subprojects',
    date: '2026-09-10',
    title: 'Projekts projekta iekšienē',
    summary: 'Lielu projektu var salikt no apakšprojektiem. Kopīgā projekta vadītājs redz un vada visus moduļus, bet moduļu vadītāji redz cits citu.',
    blocks: [
      { kind: 'p', text: 'Kad ieviešana sastāv no daudziem moduļiem un katram ir savs vadītājs, kopīgās ainas nebija ne vienam: katrs redzēja tikai savu gabalu. Tagad projektus var sasaistīt.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Kā sasaistīt',
            text: 'Atveriet kopīgo projektu → poga «Vēl» → «Apakšprojekti» → izvēlieties esošu projektu. Sasaistīt var kopīgā projekta vadītājs, ja viņš vada arī pievienojamo, un portfeļa vadītājs. Līmenis ir tikai viens: apakšprojektam savu apakšprojektu nevar būt.',
          },
          {
            title: 'Kurš ko redz',
            text: 'Kopīgā projekta vadītājs un viņa līdzvadītāji iegūst pilnu piekļuvi visiem apakšprojektiem — redz un labo. Apakšprojektu vadītāji redz kopīgo projektu un blakus apakšprojektus, bet tikai apskatei. Projektu sarakstā apakšprojekti atrodas zem sava kopīgā projekta, un sleja «Mana loma» paskaidro, kāpēc jūs redzat konkrēto projektu.',
          },
          {
            title: 'Kopīgā aina',
            text: 'Kopīgajam projektam ir parādījusies sadaļa «Apakšprojekti»: katra moduļa progress, kavējumi, augstie riski un budžets vienā tabulā, plus kopsummas augšā. Skaitļus rēķina tas pats kods, kas «Portfelī», — atšķirību starp tiem nebūs.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Tiesības pa koku parādās un pazūd uzreiz, sasaistot un atsaistot — nekas nav jāgaida. Kopīgā projekta dzēšana apakšprojektus nedzēš: tie vienkārši kļūst patstāvīgi.',
      },
    ],
  },
  {
    id: '2026-09-09-meetings-bitrix-honest',
    date: '2026-09-09',
    title: 'Sapulces un Bitrix kalendārs vairs neatšķiras',
    summary: 'Bitrix dzēsts notikums vairs nekaras portālā kā atzīme. Protokola dzēšana noņem arī notikumu.',
    blocks: [
      { kind: 'p', text: 'Protokols portālā un notikums Bitrix kalendārā dzīvoja katrs savu dzīvi: saiti varēja izveidot, bet tālāk portāls par notikumu neko nezināja. Salabots abos virzienos.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Sinhronizācija pamana dzēstos notikumus',
            text: 'Poga «Sinhronizēt» agrāk atjaunoja tikai uzdevumu statusus. Tagad tā vaicā arī Bitrix kalendāram par jūsu sapulču notikumiem: ja notikums tur ir dzēsts, portāls pats noņem atzīmi «Bitrix» un par to pasaka paziņojumā.',
          },
          {
            title: 'Atzīmi var noņemt arī tad, ja Bitrix klusē',
            text: 'Agrāk sapulcei, kuras notikums Bitrix bija dzēsts, «Noņemt no Bitrix» atbildēja ar kļūdu — un atzīmi noņemt nebija ar ko, bet izveides poga zem tās ir paslēpta. Tagad portāls vispirms pārjautā Bitrix, un, ja tas nav pieejams, piedāvā noņemt atzīmi tikai pie sevis, godīgi brīdinot, ka notikums kalendārā, ja tas vēl pastāv, paliks.',
          },
          {
            title: 'Protokola dzēšana noņem notikumu',
            text: 'Izdzēsāt sapulci portālā — notikums Bitrix kalendārā tiek dzēsts kopā ar to. Agrāk tas tur palika mūžīgi, un atrast to vairs nebija pēc kā.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Notikums tiek dzēsts tā cilvēka kalendārā, kurš to izveidoja, nevis tā, kurš nospieda pogu. Agrāk projekta līdzvadītājs saņēma atteikumu, mēģinot noņemt sveša cilvēka notikumu.',
      },
    ],
  },
  {
    id: '2026-09-04-observer-and-pm-portfolio',
    date: '2026-09-04',
    title: 'Novērotājs projektā un portfelis katram projektu vadītājam',
    summary: 'Tagad projektu var atvērt cilvēkam tikai apskatei. Un katram projektu vadītājam ir savs portfelis.',
    blocks: [
      { kind: 'p', text: 'Divas izmaiņas, un abas ir par to, kurš ko redz projektos.' },
      {
        kind: 'steps',
        items: [
          {
            title: 'Projekta novērotājs',
            text: 'Blakus pogai «Līdzvadītājs» ir parādījusies poga «Novērotājs». Novērotājs redz visu projektu — pasi, darbu plānu, riskus, budžetu, sapulces —, bet nevar neko mainīt. Projekts parādās viņa projektu sarakstā ar lomas atzīmi. Pievienot un noņemt novērotājus var projekta vadītājs un portfeļa vadītājs.',
          },
          {
            title: 'Portfelis katram projektu vadītājam',
            text: 'Sadaļa «Portfelis» tagad ir pieejama visiem projektu vadītājiem. Tā izskatās tāpat kā portfeļa vadītājam, bet rāda tikai tos projektus, kuros esat vadītājs, līdzvadītājs vai novērotājs. Projekti, kuros esat vienkārši dalībnieks, portfelī neparādās.',
          },
        ],
      },
      {
        kind: 'note',
        tone: 'tip',
        text: 'Novērotājs ir veids, kā parādīt projektu blakus nodaļai vai vadītājam, neizdalot rediģēšanas tiesības. Agrāk izvēle bija no divām: vai nu līdzvadītājs ar pilnu piekļuvi, vai nekas.',
      },
      {
        kind: 'p',
        text: 'Šeit, sadaļā «Jaunumi», turpmāk parādīsies visas nākamās portāla izmaiņas — ar datumu un cilvēcīgu paskaidrojumu, ko tagad var izdarīt. Kamēr jaunums nav izlasīts, pie izvēlnes punkta deg punktiņš.',
      },
    ],
  },
]

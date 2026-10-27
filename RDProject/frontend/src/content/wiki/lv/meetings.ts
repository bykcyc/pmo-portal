import type { WikiPage } from '../types'

export const meetingsPage: WikiPage = {
  slug: 'meetings',
  title: 'Sanāksmes un protokoli',
  summary: 'Darba kārtība, lēmumi un uzdevumi — un tas viss pats izklīst pa projektu.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/meetings`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Sanāksme bez protokola aizmirstas nedēļas laikā. Šeit tikšanos apraksta vienu reizi — darba kārtība, dalībnieki, lēmumi, uzdevumi — un portāls pats izplata rezultātu pa projektu.' },
        { kind: 'p', text: 'Sadaļa atmaksājas jau trešajā tikšanās reizē: pazūd jautājums «ko tad mēs toreiz nolēmām», un uzdevumi vairs nav jāsavāc pa saraksti. Viss pārējais no tā izriet.' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv tikšanās',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Nosaukums un datums', 'Obligāti: bez tiem sanāksme netiks saglabāta un notikumu Bitrix izveidot nevar.'],
            ['Tips', 'Sākuma sanāksme, iknedēļas sinhronizācija, vadības komiteja, pārskats, retrospektīva, pēc vajadzības.'],
            ['Laiks un ilgums', 'Ilgums pēc noklusējuma stunda, solis 15 minūtes. Tas pats nosaka, cik garu logu portāls meklē, izvēloties laiku.'],
            ['Vieta', 'Sanāksmju telpa vai saite uz tiešsaistes tikšanos. Bitrix notikuma aprakstā tā nonāk pirmajā rindā.'],
            ['Darba kārtība', 'Punkts, ziņotājs un regula. Izvēlētais ziņotājs automātiski nonāk dalībnieku sarakstā.'],
            ['Dalībnieki', 'Izvēlieties no kataloga: bez e-pasta cilvēkam neaizies protokols, bez saites ar Bitrix viņu nevar uzaicināt kalendārā un viņa aizņemtība nav redzama.'],
            ['Protokols', 'Diskusijas gaita brīvā tekstā.'],
            ['Uzdevumi un lēmumi', 'Tikšanās rezultāts. Pabeidzot sanāksmi, tie aiziet uz citām sadaļām — skatiet zemāk.'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'Izveides formā uzdevumu un lēmumu lauku nav — tie parādās pēc tam, kad sanāksme saglabāta. Izveidojiet sanāksmi, atveriet to un nospiediet «Mainīt».' },
        { kind: 'p', text: 'Ķeksīti «Piedalījās» liek pēc tikšanās, un tas neko citu neietekmē: kalendāra ielūgumi iet pa visu sarakstu.' },
      ],
    },
    {
      id: 'flow',
      title: 'Kā tas notiek',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Izveidojiet sanāksmi', text: 'Tēma, datums, laiks, dalībnieki. Darba kārtību labāk uzrakstīt iepriekš — tad cilvēki ierodas sagatavojušies.' },
            { title: 'Izveidojiet notikumu Bitrix24', text: 'Poga «Izveidot Bitrix» ieliek sanāksmi kalendārā un uzaicina dalībniekus. Portāls jau iepriekš pārbaudīs, kurš ir aizņemts.' },
            { title: 'Vadiet sanāksmi un pierakstiet', text: 'Sanāksmes gaitā ievadiet lēmumus un uzdevumus tieši sanāksmes kartītē.' },
            { title: 'Pabeidziet sanāksmi', text: 'Tas ir galvenais solis: nospiežot «Apstiprināt», lēmumi aiziet uz «Lēmumu žurnālu», bet uzdevumi — uz «Uzdevumu sarakstu».' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Neievadiet tos pašus lēmumus vēlreiz ar roku žurnālā: sanāksmes pabeigšana tos pārnes pati, un sanāks dublikāts.',
        },
      ],
    },
    {
      id: 'finalize',
      title: 'Ko dara «Pabeigt»',
      blocks: [
        { kind: 'p', text: 'Viena poga izdara trīs lietas: pārceļ sanāksmi statusā «Pabeigta», pārnes lēmumus uz «Lēmumu žurnālu» un uzdevumus uz «Uzdevumu sarakstu». Portāls parāda, cik kā aizgāja, — šī rindiņa arī ir apstiprinājums, ka pārnese notikusi.' },
        {
          kind: 'table',
          head: ['Kurp', 'Kas parādās'],
          rows: [
            ['Lēmumu žurnāls', 'Ieraksts ar kodu D-NN: lēmuma teksts, pamatojums, sanāksmes datums, statuss «Aktīvs». Laukā «Kurš pieņēma» — norādītais cilvēks, bet, ja tāda nav, — sanāksmes nosaukums.'],
            ['Uzdevumu saraksts', 'Punkts ar kodu B-NN: uzdevuma teksts, prioritāte «Vidēja», statuss «Jauns». Izpildītāja vārds nonāk kolonnā «Pieprasīja».'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Uzdevums pārceļas nepilnīgi: termiņš netiek pārnests vispār, bet izpildītājs nonāk kolonnā «Pieprasīja», nevis «Atbildīgais». Kamēr uzdevumu sarakstā nav norādīts atbildīgais un datumi, uzdevums neparādīsies nevienam sadaļā «Mani uzdevumi» un nenonāks kalendārā. Tās ir divas minūtes uzreiz pēc tikšanās — un uzdevums sāk dzīvot.',
        },
        { kind: 'p', text: 'Pabeigt atkārtoti nav bīstami: portāls atzīmē jau pārnestos ierakstus un otrreiz tos neveido. Pabeigta sanāksme kļūst tikai lasāma; lai papildinātu protokolu, nospiediet «Atcelt pabeigšanu» — jau pārnestie lēmumi un uzdevumi paliek savās vietās, nekas netiek atgriezts atpakaļ.' },
      ],
    },
    {
      id: 'slots',
      title: 'Kopīga laika meklēšana',
      blocks: [
        { kind: 'p', text: 'Poga «Atrast laiku» ieskatās visu dalībnieku Bitrix24 kalendāros — arī jūsējā — un piedāvā intervālus, kad brīvi ir visi. Meklē darba režģī: darbdienās no 9 līdz 18, ar pusstundas soli, mēnesi uz priekšu; pusdienlaiks par aizņemtu netiek uzskatīts.' },
        { kind: 'p', text: 'Portāls rāda astoņus labākos variantus, dodot priekšroku tuvākajām dienām un rītam. Ja pilnīgi brīva loga nav, tukša saraksta vietā parādās kompromisi ar parakstu «brīvi 3 no 4» — redzams, ar ko tieši nāksies upurēt.' },
        { kind: 'p', text: 'Ja kāds no viesiem tomēr ir aizņemts, portāls pajautās: veidot sanāksmi bez viņiem (tad ielūgums viņiem neaizies) vai izvēlēties citu laiku. Bet, ja tajā laikā aizņemts ir jūsu kalendārs, sanāksmi izveidot nevar: organizatoru no notikuma izslēgt nav iespējams.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Aizņemtība tiek pārbaudīta tikai tad, ja sanāksmei ir aizpildīts laiks. Bez laika portāls neko nepārbaudīs un ieliks notikumu plkst. 10:00 — arī virsū svešai tikšanās reizei, ja tur ir aizņemts. Kam nav saites ar Bitrix, tas meklēšanā nepiedalās vispār: viņa aizņemtība nav redzama, un ielūgums viņam neatnāks.',
        },
        { kind: 'p', text: 'Svešus kalendārus portāls rāda tikai ar intervāliem: cikos cilvēks ir aizņemts — redzams, ar ko tieši — nē.' },
        { kind: 'note', tone: 'info', text: 'Bitrix notikuma organizators ir tas, kurš nospieda pogu, nevis projekta vadītājs: tikšanās parādās viņa personīgajā kalendārā, un dzēst to arī viņam.' },
      ],
    },
    {
      id: 'recur',
      title: 'Regulāras tikšanās',
      blocks: [
        { kind: 'p', text: 'Poga «Atkārtot» izveido no vienas līdz divpadsmit jaunām sanāksmēm-melnrakstiem: tiek kopēta darba kārtība, dalībnieki, tips, vieta, laiks un ilgums. Protokols, lēmumi un uzdevumi netiek kopēti — tie katrai tikšanās reizei ir savi.' },
        { kind: 'p', text: '«Reizi mēnesī» šeit nozīmē «ik pēc 30 dienām», nevis to pašu datumu nākamajā mēnesī: sērija no 1. jūnija dos 1. jūliju, 31. jūliju, 30. augustu. Iknedēļas sinhronizācijai tas nav manāms, tikšanās reizei «katra mēneša pirmajā datumā» — būtiski.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Kopijas manto atzīmi «✓ Bitrix» no sākotnējās sanāksmes, lai gan pašām notikuma kalendārā nav. Nedzēsiet notikumu no kopijas ar pogu «Noņemt no Bitrix» — tiks izdzēsta oriģinālā tikšanās.',
        },
      ],
    },
    {
      id: 'look',
      title: 'Kā tas izskatās',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/meetings.png', alt: 'Projekta sanāksmju saraksts' },
      ],
    },
  ],
}

export const backlogPage: WikiPage = {
  slug: 'backlog',
  title: 'Uzdevumu saraksts (backlog)',
  summary: 'Idejas, vēlmes un uzdevumi, kuriem kārta pienāks vēlāk.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/backlog`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Ne viss, kas izskanējis, uzreiz jāliek darbu plānā. Backlog ir vieta, kur doma nepazūd, bet arī netraucē.' },
        { kind: 'p', text: 'Šeit automātiski nonāk arī uzdevumi no pabeigtajām sanāksmēm — ar tekstu un prioritāti, bet bez atbildīgā un termiņiem. Tos aizpilda tieši šeit.' },
        { kind: 'note', tone: 'tip', text: 'Noraidītos punktus nedzēsiet. «Izskatījām un nolēmām nedarīt» ir projekta robeža, un pēc pusgada tā atbild uz jautājumu «kāpēc mēs to nedarījām» labāk nekā kāda atmiņa.' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv punkts',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Kods', 'B-01, B-02 … Portāls piešķir pats.'],
            ['Nosaukums', 'Pieprasījuma būtība vienā rindā. Vienīgais obligātais lauks.'],
            ['Apraksts', 'Konteksts un pieņemšanas kritēriji. Aizceļo gan uz uzdevumu pārceļot, gan uz Bitrix24 uzdevumu.'],
            ['Prioritāte un statuss', 'Pēc noklusējuma «Vidēja» un «Jauns».'],
            ['Sākums, Novērtējums (dienas), Beigas', 'Trīs saistīti lauki: aizpildiet divus, trešo portāls aprēķinās. Dienas ir kalendārās un ieskaitot — viena diena nozīmē, ka sākums sakrīt ar beigām.'],
            ['Atbildīgais', 'Izvēlieties no kataloga. Tikai tad punkts parādīsies cilvēka sadaļā «Mani uzdevumi» un izpildītājs pārcelsies kopā ar uzdevumu uz darbu plānu.'],
            ['Pieprasīja', 'Kurš palūdza: pasūtītājs, vadītājs, tikšanās dalībnieks.'],
            ['Bitrix24', 'Saistītā uzdevuma numurs. Tukšs — poga «Izveidot».'],
          ],
        },
        { kind: 'note', tone: 'tip', text: 'Pilnu punkta aprakstu labo kartītē: nospiediet punkta kodu (B-01), zīmuli pie nosaukuma vai pašu šūnu «Apraksts». Tur lauki ir izkārtoti divās kolonnās, un apraksts prot treknrakstu, slīprakstu un sarakstus. Termiņus, prioritāti un statusu joprojām labo tieši tabulā.' },
        { kind: 'note', tone: 'info', text: 'Kods B-NN tiek izmantots atkārtoti: ja punkts B-03 izdzēsts vai pārcelts, nākamais pievienotais atkal saņems B-03. Uz kodu sarakstē atsaukties var, uzskatīt to par mūžīgu identifikatoru — nē.' },
      ],
    },
    {
      id: 'statuses',
      title: 'Kā punkts virzās',
      blocks: [
        {
          kind: 'table',
          head: ['Statuss', 'Ko tas nozīmē'],
          rows: [
            ['Jauns', 'Ideja vai pieprasījums pievienots un vēl nav izskatīts.'],
            ['Izskatīšanā', 'Vērtējam vērtību un apjomu: ņemam vai ne.'],
            ['Apstiprināts', 'Nolēmām darīt. Laiks pārcelt uz darbu plānu.'],
            ['Noraidīts', 'Izskatīts un netiks darīts. Paliek sarakstā kā apzināta projekta robeža.'],
            ['Pārcelts', 'No punkta jau izveidots uzdevums.'],
          ],
        },
        { kind: 'p', text: 'Panelis «Šajā lapā» seko līdzi tieši trim lietām: cik apstiprināto gaida pārcelšanu, cik kritisko punktu joprojām nav izskatīti un cik jaunu guļ bez kustības ilgāk par divām nedēļām. Tukšu backlog tas nenopeļ.' },
      ],
    },
    {
      id: 'promote',
      title: 'Pārcelšana uz darbu plānu',
      blocks: [
        { kind: 'p', text: 'Kad punktam pienākusi kārta, bultiņa rindā pārvērš to par īstu darbu plāna uzdevumu. Nosaukums, apraksts, prioritāte un plānotie datumi pārceļas līdzi. Arī izpildītājs — bet tikai tad, ja viņš bija izvēlēts no kataloga: ar roku ierakstītu vārdu uzdevums nemanto.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Uzdevums nonāk darbu plāna saknē, ārpus fāzēm, ar statusu «Nav sākts». Uzreiz ievelciet to vajadzīgajā fāzē — citādi tas paliks atsevišķa rinda apakšā un nepiederēs nevienai fāzei ne Ganta diagrammā, ne atskaitēs.',
        },
        { kind: 'p', text: 'Saistītais Bitrix24 uzdevums pārceļas kopā ar punktu: numurs saglabājas, otrreiz to veidot nevajag. Netiek pārnests: novērtējums dienās (uzdevumā skaita stundas), «Pieprasīja» un kods B-NN. Pati backlog rinda pēc pārcelšanas pazūd — uzdevums tagad dzīvo darbu plānā.' },
      ],
    },
    {
      id: 'bitrix',
      title: 'Uzdevums Bitrix24',
      blocks: [
        { kind: 'p', text: 'No punkta var uzstādīt uzdevumu Bitrix24, neievadot to darbu plānā, — ērti sīkiem uzdevumiem. Nosaukums Bitrix saņem projekta koda priedēkli, uzdevuma uzstādītājs ir projekta vadītājs, atbildīgais — izvēlētais cilvēks, bet termiņš — punkta plānotās beigas.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Ja blakus atbildīgajam deg «Bitrix nav tāda cilvēka», uzdevums tik un tā tiks izveidots — un aizies noklusējuma atbildīgajam, nevis tam, kuru izvēlējāties. Pārbaudiet šo brīdinājumu pirms «Izveidot».',
        },
        { kind: 'p', text: 'Atpakaļ no Bitrix nāk tikai statuss: kad izpildītājs uzdevumu aizver, backlog punkts pats kļūst izpildīts. Poga «Sinhronizēt» projekta galvenē uz backlog neattiecas — tā atjauno darbu plāna uzdevumus.' },
      ],
    },
  ],
}

import type { WikiPage } from '../types'

export const kpisPage: WikiPage = {
  slug: 'kpis',
  title: 'Veiksmes metrikas (KPI)',
  summary: 'Kā mēs sapratīsim, ka projekts izdevās, nevis vienkārši beidzās.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/kpis`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Projektu var nodot laikā un tāpat nesasniegt rezultātu. KPI ir iepriekš saskaņota atbilde uz jautājumu «kam jāmainās».' },
        { kind: 'note', tone: 'tip', text: 'Labs KPI ir izmērāms, un tam ir formula: nevis «paātrināt pieteikumu apstrādi», bet «vidējais pieteikuma apstrādes laiks — no 3 dienām uz 1, rēķinām pēc CRM datiem par mēnesi».' },
      ],
    },
    {
      id: 'fields',
      title: 'No kā sastāv metrika',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Mērķis', 'Metrikas nosaukums: ko tieši mērām. Obligāts lauks.'],
            ['Statuss', 'Normā, apdraudēts vai novirze. Liek ar roku — portāls neko neaprēķina.'],
            ['Apraksts', 'Konteksts un — svarīgi — mērķa vērtība: «no 3 dienām uz 1», «ne zemāk par 95%». Atsevišķas kolonnas skaitlim sadaļā nav.'],
            ['Formula', 'Kā rēķinām: no kurienes ņemam datus, par kādu periodu, kurš nolasa.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Mērķa vērtību tiešām raksta laukā «Apraksts» — tas nav apvedceļš, bet pieņemtais veids: sadaļa glabā vienošanos par to, kā mērīt, nevis automātisku skaitītāju.',
        },
      ],
    },
    {
      id: 'statuses',
      title: 'Trīs statusi',
      blocks: [
        {
          kind: 'table',
          head: ['Statuss', 'Kad likt'],
          rows: [
            ['Normā', 'Metrika iet pēc plāna — pietiek ar ierastu novērošanu.'],
            ['Apdraudēts', 'Parādījušās novirzes pazīmes. Rīkoties vajag tagad, kamēr nav kļuvis sarkans.'],
            ['Novirze', 'Mērķis vairs netiek sasniegts. Tas ir iemesls analīzei un lēmumam, nevis kārtējam «pacentīsimies vairāk».'],
          ],
        },
        { kind: 'p', text: 'Statusus atjauno katra atskaites perioda beigās — reizē ar statusa atskaiti. Metrika, kurai pusgadu ir «Normā» bez neviena labojuma, parasti nozīmē, ka to neviens nav skatījis.' },
      ],
    },
    {
      id: 'howto',
      title: 'Kā aizpildīt',
      blocks: [
        { kind: 'p', text: 'Orientieris — trīs metrikas, panelis «Šajā lapā» atgādinās, kamēr to ir mazāk. Katrai: kā rēķinām, kas bija sākumā un uz ko ejam. Metrika bez formulas pēc mēneša pārvēršas strīdā par to, kā to mērīt, — arī uz to panelis skatās atsevišķi.' },
        { kind: 'p', text: 'Ar vienu metriku gandrīz vienmēr ir par maz: termiņi, nauda un kvalitāte velk uz dažādām pusēm, un projekts, kuram mēra tikai ātrumu, sāk ekonomēt uz visa pārējā. Trīs līdz piecas metrikas no dažādām pusēm arī ir aizsardzība pret šādu sasvēršanos.' },
        { kind: 'note', tone: 'info', text: 'Portāls pēc šiem skaitļiem neko neaprēķina un nekur tos neievieto: statusa atskaitē un portfelī KPI nenonāk. Tā ir jūsu vienošanās ar pasūtītāju par to, ko uzskatīt par panākumiem, — tās vērtība ir tieši tik liela, cik regulāri pie tās atgriežaties.' },
      ],
    },
  ],
}

export const assumptionsPage: WikiPage = {
  slug: 'assumptions',
  title: 'Pieņēmumi un ierobežojumi',
  summary: 'Uz kā balstās plāns un ko mēs nevaram mainīt.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/assumptions`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Pieņēmums ir tas, ko uzskatām par patiesu, to nepārbaudījuši: «uzņēmējs sāks martā», «datus no vecās sistēmas var izgūt». Ierobežojums ir tas, ko mainīt nevar: budžets, termiņš, likuma prasības.' },
        { kind: 'p', text: 'Sadaļas jēga ir tāda, ka pieņēmumiem piemīt īpašība nepiepildīties. Pierakstīts pieņēmums laikus pārtop riskā, nepierakstīts — pārsteigumā.' },
      ],
    },
    {
      id: 'kinds',
      title: 'Trīs ierakstu veidi',
      blocks: [
        {
          kind: 'table',
          head: ['Tips', 'Kas tas ir', 'Piemērs'],
          rows: [
            ['Pieņēmums', 'Tas, ko sākumā uzskatām par patiesu un liekam plāna pamatā, kamēr nav faktu.', '«Pasūtītājs iedos testa datus līdz 1. martam».'],
            ['Ierobežojums', 'Cieta rāmja mala, ko nevar brīvi mainīt: budžets, termiņš, resurss, tehnoloģija, noteikums.', '«Budžets 40 000 eiro, palielināt nevar».'],
            ['Atkarība', 'Ārējs faktors vai citu cilvēku darbs, no kā esat atkarīgi, bet ko nekontrolējat.', '«Kamēr nebeigsies pasta migrācija, integrāciju ieslēgt nevar».'],
          ],
        },
        { kind: 'p', text: 'Atšķirība ir praktiska. Pieņēmumu pārbauda, un tas var sabrukt. Ierobežojumu nepārbauda — ar to dzīvo un plāno tā ietvaros. Atkarībai seko līdzi pie kaimiņiem: visbiežāk tieši tā arī izjauc termiņus.' },
      ],
    },
    {
      id: 'howto',
      title: 'Kā aizpildīt',
      blocks: [
        {
          kind: 'table',
          head: ['Lauks', 'Ko rakstīt'],
          rows: [
            ['Apraksts', 'Formulējums pilnībā, lai to saprot arī malā stāvošs cilvēks. Obligāts lauks.'],
            ['Tips', 'Pieņēmums, ierobežojums vai atkarība.'],
            ['Atbildīgais', 'Kurš pārbaudīs, vai ieraksts joprojām ir spēkā.'],
            ['Statuss', 'Aktīvs (jāseko līdzi), Apstiprināts (pārbaudīts — pareizi), Nederīgs (izrādījās nepareizi).'],
          ],
        },
        { kind: 'note', tone: 'warn', text: 'Atbildīgais šeit glabājas kā teksts, nevis kā saite uz cilvēku. Drukas kļūda uzvārdā vai ieraksts «IT nodaļa» vārda vietā nozīmē, ka ieraksts neparādīsies cilvēka sadaļā «Mani uzdevumi», — izvēlieties no kataloga ieteikumiem.' },
        { kind: 'p', text: 'Statuss «Nederīgs» ir vērtīgākais, kas sadaļā ir, un vienlaikus tas, ko visbiežāk aizmirst atzīmēt. Sabrucis pieņēmums nozīmē, ka plāns balstījās uz nepatiesa, un portāls par to tikai atgādinās panelī labajā pusē: pārnest sekas darbu plānā un ieviest risku nāksies jums.' },
        { kind: 'p', text: 'Ritms — reizi pāris nedēļās pārskriet sarakstam pāri un atjaunot statusus. Pieņēmums, pie kura nav atgriezušies kopš projekta sākuma, vairs nav pieņēmums, bet cerība.' },
      ],
    },
  ],
}

export const commPlanPage: WikiPage = {
  slug: 'comm-plan',
  title: 'Komunikāciju plāns',
  summary: 'Ko, par ko un cik bieži informējam.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/comm-plan`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Biežākais pārmetums projektiem — «mūs nebrīdināja». Komunikāciju plāns to novērš laikus: vienreiz vienojaties, kurš ko saņem, un tālāk to vienkārši izpilda.' },
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
            ['Komunikācijas mērķis', 'Kāpēc tā vajadzīga: «turēt sponsoru lietas kursā par riskiem», «sinhronizēt komandu par nedēļas uzdevumiem». Obligāts lauks.'],
            ['Kanāls', 'Kā tieši: vēstule, tikšanās Teams, lapa zināšanu bāzē, čats.'],
            ['Auditorija', 'Kam: vadības komitejai, komandai, gala lietotājiem, konkrētai nodaļai.'],
            ['Biežums', 'Cik bieži: reizi nedēļā, reizi divās nedēļās, pēc katra posma.'],
            ['Atbildīgais', 'Kurš sagatavo un nosūta. Izvēlieties no kataloga — šis cilvēks ieraudzīs punktu savā sadaļā «Mani uzdevumi».'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'Portāls pēc šī plāna neko neizsūta: tas neaizsūtīs vēstuli piektdienā un neatgādinās par tikšanos. Tā ir vienošanās starp cilvēkiem, nevis automatizācija — vienīgais, ko portāls dara, ir parāda punktu atbildīgajam viņa personīgajā sarakstā.' },
      ],
    },
    {
      id: 'howto',
      title: 'Kā aizpildīt',
      blocks: [
        { kind: 'p', text: 'Vismaz divas rindas: kā atskaitāmies augšup un kā sinhronizējas komanda. Katrai — atbildīgais un biežums, citādi vienošanās pārvēršas par vēlējumu; tieši to arī pārbauda panelis «Šajā lapā».' },
        { kind: 'p', text: 'Labs orientieris — iziet cauri ieinteresēto pušu sarakstam no ietekmes matricas augšējās puses un pārliecināties, ka katrs no viņiem šajā plānā kaut kur ir minēts. Cilvēks ar augstu ietekmi, par kuru plānā nav ne rindiņas, ir nākotnes frāze «kāpēc es par to uzzinu pēdējais».' },
        { kind: 'note', tone: 'tip', text: 'Trīs līdz piecas rindas ir gana. Komunikāciju plāns no piecpadsmit punktiem netiek izpildīts nekad — un pirmais pārstāj darboties tieši tas, kas patiešām bija svarīgs.' },
      ],
    },
  ],
}

export const kanbanPage: WikiPage = {
  slug: 'kanban',
  title: 'Uzdevumu tāfele',
  summary: 'Tas pats darbu plāns, sakārtots pēc statusiem.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/kanban`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Tāfele nav atsevišķs saraksts: tie ir tie paši uzdevumi no darbu sadalījuma, sakārtoti pa statusu kolonnām. Ērti vadīt plānošanas sanāksmi — redzams, kas ir iestrēdzis.' },
        { kind: 'p', text: 'Pārvilkāt kartīti uz citu kolonnu — uzdevuma statuss mainījās gan tabulā, gan atskaitēs.' },
      ],
    },
    {
      id: 'look',
      title: 'Kā tas izskatās',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/kanban.png', alt: 'Uzdevumu tāfele ar kolonnām pēc statusiem' },
      ],
    },
  ],
}

export const baselinePage: WikiPage = {
  slug: 'baseline',
  title: 'Bāzlīnija',
  summary: 'Saskaņotā plāna momentuzņēmums, ar kuru vēlāk salīdzina faktu.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/baseline`,
  sections: [
    {
      id: 'why',
      title: 'Kāpēc tas vajadzīgs',
      blocks: [
        { kind: 'p', text: 'Kad plāns ir saskaņots, no tā izveido momentuzņēmumu. Tālāk termiņi var kustēties — bet vienmēr redzams, cik tālu tie aizgājuši no norunātā.' },
        { kind: 'p', text: 'Bez bāzlīnijas «pārbīdījām par divām nedēļām» pārtop par «tā jau bija iecerēts».' },
      ],
    },
    {
      id: 'when',
      title: 'Kad to fiksēt',
      blocks: [
        {
          kind: 'note',
          tone: 'warn',
          text: 'Fiksējiet bāzlīniju PĒDĒJO — kad visi uzdevumi jau ir ievadīti. Uzdevums, kas pievienots pēc momentuzņēmuma, skaitīsies kā tāds, kas radies virs plāna, pat ja par to bija runāts iepriekš.',
        },
        { kind: 'p', text: 'Gatavības pazīme ir vienkārša: darbu plānu jūs jau esat parādījis pasūtītājam, un viņš nestrīdas. Līdz tam brīdim momentuzņēmums fiksē melnrakstu, un visas turpmākās novirzes izrādīsies novirzes no melnraksta.' },
        { kind: 'p', text: 'Momentuzņēmumu noņem ar pogu «Saglabāt bāzlīniju». Tam dod nosaukumu — pēc tā vēlāk arī atpazīst: «Saskaņots 15.09», «Pēc pilota pārcelšanas», «Versija valdei». Bezvārda momentuzņēmumi pēc trim mēnešiem nav atšķirami.' },
      ],
    },
    {
      id: 'compare',
      title: 'Kā lasīt novirzi',
      blocks: [
        { kind: 'p', text: 'Izvēlieties momentuzņēmumu — portāls parādīs starpību starp to un pašreizējo plānu: kuri uzdevumi ir pārbīdījušies un par cik dienām, kuri parādījušies pēc momentuzņēmuma, kuri pazuduši. Rindas ar nobīdi redzamas uzreiz, pārējās netraucē.' },
        { kind: 'p', text: 'Laukā «Salīdzināt ar» var izvēlēties nevis pašreizējo plānu, bet citu momentuzņēmumu. Tad savstarpēji tiek salīdzināti divi saskaņoti plāni — tas noder, kad termiņi tika oficiāli pārcelti un vēlaties parādīt, kas mainījies starp divām vienošanām, nevis starp plānu un šodienu.' },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Novirze ir materiāls sarunai, nevis apsūdzība. «Kavējam 12 dienas, no tām 10 — gaidot piekļuvi pie uzņēmēja» der labāk nekā «kavējam 12 dienas».',
        },
        {
          kind: 'shot',
          src: '/wiki-shots/baseline.png',
          alt: 'Pašreizējā plāna salīdzinājums ar momentuzņēmumu: nobīde dienās katram uzdevumam',
          caption: 'Filtrs «plāns mainījies pēc momentuzņēmuma» atstāj tikai nobīdītās rindas — ar tām saruna arī sākas.',
        },
      ],
    },
    {
      id: 'howmany',
      title: 'Cik momentuzņēmumu turēt',
      blocks: [
        { kind: 'p', text: 'Viens obligāts — sākotnējais, saskaņotais. Tālāk jaunu momentuzņēmumu veido, kad termiņi oficiāli pārsaskaņoti: pārcelts posms, pievienots apjoms, nobīdīta nodošana. Nevis pēc katra labojuma — citādi vēsture pārvēršas troksnī un salīdzināt vairs nav ar ko.' },
        { kind: 'p', text: 'Prakse: divi līdz četri momentuzņēmumi projektā. Ja to ir desmit, plāns tika pārrakstīts, nevis vadīts.' },
      ],
    },
  ],
}

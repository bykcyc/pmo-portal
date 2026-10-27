import type { WikiPage } from '../types'

export const wbsGanttPage: WikiPage = {
  slug: 'wbs-gantt',
  title: 'Darbu plāns un Ganta diagramma',
  summary: 'Uzdevumu saraksts ar termiņiem un izpildītājiem — no tā pats uzzīmējas grafiks.',
  group: 'project',
  appRoute: (pid) => `/projects/${pid ?? ''}/wbs`,
  sections: [
    {
      id: 'idea',
      title: 'Galvenā doma',
      blocks: [
        { kind: 'p', text: 'Ganta diagramma un uzdevumu tāfele nav jāaizpilda atsevišķi. Ir viens darbu saraksts — «Darbu sadalījums (WBS)». Uzdevums ar datumiem parādās Gantā, uzdevums ar statusu parādās tāfelē.' },
        { kind: 'p', text: 'Darbi ir divu veidu: fāze — liels bloks (piemēram, «Sagatavošanās»), un uzdevums — tas, ko tiešām dara. Uzdevumi ietilpst fāzēs.' },
      ],
    },
    {
      id: 'howto',
      title: 'Kā aizpildīt',
      blocks: [
        {
          kind: 'steps',
          items: [
            { title: 'Sadaliet projektu fāzēs', text: 'Trīs līdz pieci lieli bloki. Ne vairāk — citādi plānu vairs nevarēs izlasīt.' },
            { title: 'Fāzēs uzskaitiet uzdevumus', text: 'Formulējums — pabeigta darbība ar rezultātu, nevis tēma.' },
            { title: 'Norādiet termiņus un izpildītājus', text: 'Uzdevums bez izpildītāja ir neviena, bez termiņa — mūžīgs. Portāls izcels abus gadījumus.' },
            { title: 'Sasaistiet uzdevumus', text: 'Kolonna «Atkarīgs no»: ja uzdevums nevar sākties agrāk par citu. Pārbīdījāt priekšteci — sekotāji pārbīdās līdzi.' },
          ],
        },
        { kind: 'note', tone: 'tip', text: 'Izpildītāju izvēlieties no cilvēku kataloga, nevis rakstiet ar tekstu: tad uzdevums nonāks cilvēka sadaļā «Mani uzdevumi» un vajadzības gadījumā aizies uz Bitrix24.' },
      ],
    },
    {
      id: 'look',
      title: 'Kā tas izskatās',
      blocks: [
        { kind: 'shot', src: '/wiki-shots/wbs.png', alt: 'Darbu sadalījuma tabula ar fāzēm un uzdevumiem' },
        { kind: 'shot', src: '/wiki-shots/gantt.png', alt: 'Ganta diagramma, kas uzbūvēta no tiem pašiem uzdevumiem',
          caption: 'Tas pats plāns Gantā — atsevišķi to aizpildīt nevajag.' },
      ],
    },
    {
      id: 'columns',
      title: 'Tabulas kolonnas',
      blocks: [
        { kind: 'p', text: 'Kolonnu ir daudz, un visas uzreiz nav vajadzīgas. Kolonnu iestatījumu poga pa labi virs tabulas paslēpj liekās, bet platumu var vilkt aiz galvenes malas.' },
        {
          kind: 'table',
          head: ['Kolonna', 'Nozīme'],
          rows: [
            ['WBS', 'Darba numurs struktūrā, portāls to aprēķina pats.'],
            ['Sākums / Beigas', 'Plānotie datumi. No tiem veidojas Ganta diagramma.'],
            ['Fakt. sākums / beigas', 'Kad darbu patiešām sāka un pabeidza.'],
            ['Progress', 'Izpildes procents — pēc tā aprēķinās arī visa projekta progress.'],
            ['Statuss', 'Nav sākts, izpildē, pabeigts, pauzē, atcelts.'],
            ['Atkarīgs no', 'Uzdevums-priekštecis.'],
            ['Bitrix24', 'Uzdevuma numurs Bitrix, ja tas tika nosūtīts uz turieni.'],
          ],
        },
      ],
    },
    {
      id: 'cascade',
      title: 'Saites un kaskādes nobīde',
      blocks: [
        { kind: 'p', text: 'Saiti izveido divos veidos: velkot ar peli no joslas uz joslu Ganta diagrammā vai izvēloties priekšteci uzdevuma kartītē blokā «Atkarīgs no». Portāls saprot saiti «pabeigt → sākt»: pēctecis nesākas agrāk, nekā beidzas priekštecis.' },
        { kind: 'p', text: 'Pabīdījāt priekšteci — visi pēcteči pa ķēdi aizbrauc par to pašu dienu skaitu, kopā ar atstarpēm. Tas darbojas vienādi gan velkot joslu, gan labojot datumu tabulā. Pārvietojas tikai tie uzdevumi, kuriem aizpildīti abi plānotie datumi.' },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Automātiskas plānošanas portālā nav. Tas nezina brīvdienas un ražošanas kalendāru, neizlīdzina cilvēku noslodzi un nepārrēķina plānu pēc ierobežojumiem. Vienīgā automātika — pēcteču nobīde par to pašu delta; viss pārējais ir jūsu lēmums.',
        },
        { kind: 'p', text: 'Kritisko ceļu portāls aprēķina pats un apvelk sarkanā krāsā. To rēķina TIKAI pa saistītajiem uzdevumiem: uzdevums bez nevienas atkarības nekad nekļūs kritisks, lai cik garš tas būtu. Tas ir vēl viens iemesls saistīt vismaz galvenos darbus.' },
      ],
    },
    {
      id: 'gantt',
      title: 'Ganta diagramma',
      blocks: [
        { kind: 'p', text: 'Grafiks veidojas no tiem pašiem uzdevumiem. Joslu var vilkt ar peli — datumi tabulā mainīsies, bet saistītie uzdevumi pārbīdīsies līdzi.' },
        { kind: 'note', tone: 'info', text: 'Ja fāzei nav redzams termiņš — nozīmē, ka tās uzdevumiem nav norādīti datumi. Gants zīmē tikai to, kam ir datumi.' },
      ],
    },
  ],
}

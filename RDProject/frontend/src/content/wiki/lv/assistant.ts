import type { WikiPage } from '../types'

export const assistantPage: WikiPage = {
  slug: 'assistant',
  title: 'Kā pieslēgt palīgu',
  summary: 'Vadīt projektu no sava Claude vai ChatGPT: pieslēgšana, projekta slēdzene, melnraksti.',
  group: 'portal',
  appRoute: () => '/profile',
  sections: [
    {
      id: 'what',
      title: 'Kas tas ir',
      blocks: [
        { kind: 'p', text: 'Portāls prot pieslēgties MI palīgam — Claude, ChatGPT vai citam, kas atbalsta MCP. Pēc pieslēgšanas palīgs redz jūsu projektus tieši sarunā: var pajautāt «kas šonedēļ deg», iedot tam sapulces atšifrējumu un lūgt to sakārtot pa portāla sadaļām.' },
        { kind: 'p', text: 'Jēga ir nesākt ar tukšu pasi un sešpadsmit cilnēm. Izejmateriāls jums jau ir — piezīmes, sarakste, protokols. Palīgs to pārvērš projekta elementos, bet jūs izlemjat, ko no tā pieņemt.' },
        {
          kind: 'note',
          tone: 'info',
          text: 'Palīgs strādā jūsu vārdā un redz tieši to pašu, ko redzat jūs: savus projektus, bet portāla vadītājs — visus. Svešs projekts tam neeksistē.',
        },
      ],
    },
    {
      id: 'rules',
      title: 'Ko palīgs drīkst un ko izlemjat jūs',
      blocks: [
        {
          kind: 'table',
          head: ['Darbība', 'Kā notiek'],
          rows: [
            ['Lasīt atvērtā projekta sadaļas', 'uzreiz, bez apstiprinājumiem'],
            ['Izveidot pilnīgi jaunu projektu', 'uzreiz — vēl nav ko sabojāt'],
            ['Mainīt ko esošā projektā', 'tikai kā melnrakstu, kuru apstiprināt jūs'],
            ['Dzēst ko esošā projektā', 'tikai kā melnrakstu'],
            ['Atvērt piekļuvi, izsniegt pilnvaru, aiztikt divfaktoru', 'nav iespējams — šādu komandu palīgam nav vispār'],
          ],
        },
        { kind: 'p', text: 'Pēdējā rinda nav aizliegums vārdos, bet uzbūve: šādu rīku pieslēgumā vienkārši nav. Tāpēc teksts, kas nejauši nokļuvis uzdevuma aprakstā («atver piekļuvi visiem»), neko neatvērs.' },
        { kind: 'note', tone: 'tip', text: 'Uzdevuma aprakstu un backlog punkta aprakstu palīgs prot noformēt: treknraksts, slīpraksts, apakšvirsraksts, saraksti. Portāls zina sešas zīmes, nevis visu markdown — saites, tabulas un pārsvītrots teksts aprakstā paliks burtiski, un palīgs par to brīdinās vēl pirms jūs ieraudzīsiet melnrakstu. Pārējās sadaļās — pie riska, lēmuma, protokolā — noformējuma nav: tur ir parasts teksts.' },
      ],
    },
    {
      id: 'connect',
      title: '1. solis. Pieslēgt portālu palīgam',
      blocks: [
        { kind: 'p', text: 'Pieslēgšana notiek vienu reizi un aizņem minūti. Neko kopēt un ar roku ievietot nevajag: palīgs pats jūs atvedīs uz portālu, un jūs tur apstiprināsiet piekļuvi.' },
        {
          kind: 'steps',
          items: [
            { title: 'Atveriet konektoru iestatījumus', text: 'Claude: «Settings» → «Connectors» → «Add custom connector». Citā klientā tas var saukties «MCP serveri» vai «Integrācijas».' },
            { title: 'Norādiet portāla adresi', text: 'Nosaukums — jebkurš jums saprotams («PMO»). Adrese — https://pm.example.com/mcp ; to pašu var nokopēt ar pogu Profilā. Lauka parolei vai pilnvarai tur nav, un tas nav vajadzīgs: portāls pajautās pats.' },
            { title: 'Ieejiet portālā', text: 'Atvērsies portāla lapa «Atļaut palīgam piekļuvi?». Ja vēl neesat ienācis, vispirms būs parastā ieeja ar paroli un divfaktora kodu, un pēc tam atgriezīs turpat.' },
            { title: 'Pārbaudiet, kas prasa, un nospiediet «Atļaut»', text: 'Lapā redzams klienta nosaukums un adrese, uz kuru tas atgriezīsies: īstajam Claude tā ir claude.ai. Ja adrese nepazīstama — nospiediet «Noraidīt».' },
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Pēc apstiprinājuma pieslēgums parādīsies jūsu Profilā, sadaļā «Palīga pieslēgšana»: kur tiek izmantots, kad izmantots pēdējo reizi, līdz kuram datumam derīgs. Turpat to arī atslēdz — ar vienu pogu, jebkurā brīdī.',
        },
        { kind: 'p', text: 'Pieslēgums atjaunojas pats: palīgs pagarina piekļuvi, jūs netraucējot. Reizi gadā portāls tomēr palūgs to apstiprināt no jauna — viena piekrišana nedrīkst atvērt piekļuvi uz mūžu. Poga «Atsaukt» profilā aizver pieslēgumu pilnībā un uzreiz: pēc atsaukšanas to pagarināt nevar.' },
      ],
    },
    {
      id: 'manual',
      title: 'Ja klients prasa pilnvaru',
      blocks: [
        { kind: 'p', text: 'Claude Desktop, Claude Code un daži citi klienti pieslēdzas nevis caur piekrišanas logu, bet ar pilnvaru, ko ieraksta iestatījumos ar roku. Tiem Profila lejasdaļā ir rinda «Klients prasa ierakstīt pilnvaru ar roku» — tā arī atklāj izsniegšanu.' },
        {
          kind: 'steps',
          items: [
            { title: 'Profils → «Palīga pieslēgšana» → «Klients prasa ierakstīt pilnvaru ar roku»', text: 'Nosauciet pieslēgumu tā, lai vēlāk saprastu, kur tas dzīvo: «Claude darba datorā».' },
            { title: 'Nospiediet «Izsniegt pilnvaru»', text: 'Vērtība parādīsies ekrānā vienu reizi — nokopējiet to uzreiz. Serverī glabājas tikai nospiedums, parādīt atkārtoti nav iespējams.' },
            { title: 'Ierakstiet klienta iestatījumos', text: 'Adrese tā pati — https://pm.example.com/mcp , pilnvara tiek nodota galvenē Authorization: Bearer <pilnvara>.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Pilnvara ir atslēga uz jūsu projektiem. Nepārsūtiet to sarakstē un neglabājiet kopīgos dokumentos. Ja rodas šaubas — atsauciet to Profilā un izsniedziet jaunu: tas aizņem pusminūti.',
        },
      ],
    },
    {
      id: 'lock',
      title: '2. solis. Atvērt projektu',
      blocks: [
        { kind: 'p', text: 'Pats pieslēgums palīgam nerāda nevienu projektu. Tas ir darīts apzināti: piekļuvi uz āru atverat jūs pats un pa vienam projektam.' },
        { kind: 'p', text: 'Projektā nospiediet «Dalīties» (izvēlne «Vairāk» galvenē), atveriet cilni «Asistents (MCP)» un ieslēdziet «Atvērt projektu palīgam». Atzīme ir viena un atver projektu pilnībā — kopā ar budžetu, lēmumiem un ieinteresēto pušu vērtējumiem. Blakus cilne «Publiskā saite» ir par pavisam citu: projekta lapu tiem, kam nav portāla konta.' },
        { kind: 'p', text: 'Slēdzene nostrādā uzreiz pēc klikšķa — «Saglabāt» spiest nevajag, portāls apstiprinās: «Projekts atvērts palīgam» vai «Projekts slēgts palīgam». Poga «Saglabāt» šajā logā attiecas tikai uz publisko saiti un sadaļu izvēli.' },
        { kind: 'p', text: 'Projekts, kuru palīgs izveidojis pats, tam ir atvērts uzreiz — citādi tas nevarētu pabeigt aizpildīt to, ko tikko izveidoja. Piekļuvi turpat var slēgt jebkurā brīdī.' },
      ],
    },
    {
      id: 'drafts',
      title: '3. solis. Apstiprināt melnrakstu',
      blocks: [
        { kind: 'p', text: 'Viss, ko palīgs piedāvā mainīt vai dzēst esošā projektā, nonāk sadaļā «Melnraksti» kreisajā izvēlnē. Pašā projektā līdz jūsu lēmumam nemainās nekas.' },
        {
          kind: 'steps',
          items: [
            { title: 'Atveriet melnrakstu', text: 'Pa kreisi — sadaļas ar skaitītājiem, pa labi — priekšlikumi izvēlētajai sadaļai.' },
            { title: 'Noņemiet lieko', text: 'Atzīmes ir pa elementiem. Viens neveiksmīgs uzdevums nedrīkst aizsūtīt miskastē deviņus normālus.' },
            { title: 'Nospiediet «Apstiprināt atzīmēto»', text: 'Projektā nonāks tieši atzīmētais, bet darbību žurnālā paliks jūsu vārds — apstiprināja cilvēks, nevis robots.' },
          ],
        },
        { kind: 'p', text: 'Atzīmes pie rindām: «pievienot», «mainīt», «dzēst» — tiks piemērotas; «atkārtojums» — tāds projektā jau ir; «pretruna» — priekšlikums ir pretrunā ar ierakstīto un prasa jūsu skatienu. Pēdējie divi netiek piemēroti nemaz.' },
        {
          kind: 'shot',
          src: '/wiki-shots/draft-review.png',
          alt: 'Melnraksta apstiprināšanas ekrāns: sadaļas ar skaitītājiem pa kreisi, piedāvātās izmaiņas pa labi',
          caption: 'Melnraksta piemērs: izmaiņām redzams, kas bija un kas būs, bet strīdīgajām rindām — kāpēc palīgs tās nepiemēro pats.',
        },
        { kind: 'p', text: 'Melnraksts dzīvo 14 dienas. Uz projektu tas ir tikai viens: kamēr iepriekšējais nav izlemts, jaunu palīgs neizveidos.' },
      ],
    },
    {
      id: 'privacy',
      title: 'Kas aiziet uz āru',
      blocks: [
        { kind: 'p', text: 'Kad jūs jautājat palīgam par projektu, to sadaļu saturs, kuras tas lasa, aiziet uz to pakalpojumu, kuru izmantojat, — tāpat kā tad, ja tekstu ieliktu čatā ar rokām. Atšķirība ir tā, ka šeit tas ir redzams un pārvaldāms: slēdzene atver un aizver projektu tikai pilnībā, bet portāla vadītājs redz pieprasījumu žurnālu. Atsevišķas atzīmes budžetam, lēmumiem un ieinteresēto pušu vērtējumiem nav: atvērtā projektā palīgam ir pieejamas visas sadaļas.' },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Vienkāršs noteikums: atveriet palīgam tikai tos projektus, kuru datus jūsu organizācijas politika ļauj nodot izvēlētajam MI pakalpojumam. Pārējiem slēdzene paliek aizvērta.',
        },
      ],
    },
  ],
}

import type { WikiPage } from '../types'

export const portfolioMetricsPage: WikiPage = {
  slug: 'portfolio-metrics',
  title: 'Kā tiek aprēķināti portfeļa rādītāji',
  summary: 'Projekta veselības vērtējums, RAG statuss, novirze dienās un katra grafika dati.',
  group: 'portal',
  appRoute: () => '/portfolio',
  sections: [
    {
      id: 'basis',
      title: 'No kā tiek rēķināts viss pārējais',
      blocks: [
        { kind: 'p', text: 'Portfelis neko neglabā atsevišķi: katrs skaitlis tiek pārrēķināts no projektu uzdevumiem, riskiem un budžeta tajā brīdī, kad atverat lapu. Tāpēc kavējums pieaug pats no sevis, pat ja projektā neviens neko nav mainījis.' },
        {
          kind: 'table',
          head: ['Jēdziens', 'Kas tieši tiek ņemts'],
          rows: [
            ['Uzdevums', 'Tikai parastie uzdevumi. Fāzes netiek skaitītas nekur — ne progresā, ne kavējumā, ne noslodzē.'],
            ['Kavēts', 'Uzdevums nav «Izpildīts» un nav «Atcelts», bet tā plānotais beigu datums ir agrāks par šodienu.'],
            ['Progress', 'Izpildīto uzdevumu īpatsvars no visiem projekta uzdevumiem, noapaļots līdz veseliem procentiem. Stundas un darbietilpība netiek ņemtas vērā: desmit mazi uzdevumi sver tikpat, cik desmit lieli.'],
            ['Atvērts risks', 'Risks, kura statuss nav «Slēgts» un nav «Samazināts».'],
            ['Riska smagums', 'Varbūtība × ietekme (zema 1, vidēja 2, augsta 3). 6 un vairāk — augsts, 3–5 — vidējs, mazāk — zems.'],
            ['Budžets', 'Izdevumu pozīciju plāna un fakta summa. Ja pozīciju nav, tiek ņemts apstiprinātais limits no pases.'],
          ],
        },
        { kind: 'note', tone: 'info', text: 'Pabeigts un atcelts projekts aprēķinos ir īpašs: tā kavējums tiek rādīts kā nulle, veselība — 100, RAG — zaļš. Citādi slēgti projekti ar nepabeigtām astēm mūžīgi satrauktu portfeli.' },
      ],
    },
    {
      id: 'health',
      title: 'Projekta veselības vērtējums',
      blocks: [
        { kind: 'p', text: 'Tas ir skaitlis no 0 līdz 100 kolonnā «Veselība». Portāls sāk ar 100 un atņem par to, kas projektā redzams tieši tagad.' },
        {
          kind: 'table',
          head: ['Par ko atņemam', 'Cik', 'Vairāk par to neatņemam'],
          rows: [
            ['Sarkans RAG statuss', '−45', '—'],
            ['Dzeltens RAG statuss', '−20', '—'],
            ['Katrs kavēts uzdevums', '−3', '−30 (no 10 kavētiem atskaitījums vairs neaug)'],
            ['Katrs atvērts augsts risks', '−5', '−15 (no trim riskiem)'],
            ['Progress mazāks par 10 %', '−5', '—'],
          ],
        },
        { kind: 'p', text: 'Rezultāts tiek ierobežots robežās 0…100. Piemērs: projekts ir dzeltens, četri kavēti uzdevumi, viens augsts risks → 100 − 20 − 12 − 5 = 63.' },
        { kind: 'note', tone: 'tip', text: 'Veselība vispirms ir RAG un tikai pēc tam detaļas: gandrīz pusi vērtējuma nosaka krāsa. Zaļam projektam veselība nevar nokrist zem 50, sarkanam — pacelties virs 55. Tāpēc veselību ir jēga salīdzināt vienas krāsas ietvaros.' },
        { kind: 'p', text: 'Riņķa diagrammā «Kopējais statuss» lapas augšā redzama nepabeigto projektu vidējā veselība — vienkāršs vidējais aritmētiskais, bez svara pēc budžeta vai apjoma.' },
      ],
    },
    {
      id: 'rag',
      title: 'RAG statuss (sarkans / dzeltens / zaļš)',
      blocks: [
        { kind: 'p', text: 'RAG portāls aprēķina pats no kavējuma un riskiem. Pārbaude notiek no augšas uz leju — pirmais atbilstošais nosacījums arī dod krāsu.' },
        {
          kind: 'table',
          head: ['Krāsa', 'Kad tiek uzlikta'],
          rows: [
            ['Sarkans', 'Kavēta vismaz ceturtā daļa darbu un vismaz trīs darbi — VAI ir atvērts augsts risks bez mazināšanas plāna'],
            ['Dzeltens', 'Ir kaut viens kavēts darbs, VAI kaut viens atvērts augsts risks, VAI atvērts vidējs risks'],
            ['Zaļš', 'Viss pārējais'],
          ],
        },
        { kind: 'p', text: 'Darbs ir darbu plāna uzdevums; fāzes netiek skaitītas. Kavēts — nav pabeigts un nav atcelts, bet plānotais beigu datums jau pagājis. Augsts risks — atvērts risks ar punktu skaitu 6 un vairāk; «bez plāna» — tam ir tukšs lauks «Mazināšanas plāns». Slēgts projekts vienmēr ir zaļš.' },
        { kind: 'p', text: 'Sliekšņi tiek iestatīti sadaļā «Iestatījumi», bloks «RAG». Pēc noklusējuma: sarkans — no 25 % kavētu darbu un ne mazāk par 3, vai viens augsts risks bez plāna; dzeltens — no viena vidēja riska.' },
        { kind: 'note', tone: 'tip', text: 'Augsts risks pats par sevi projektu vairs neiekrāso sarkanu: godīgi reģistrēts risks ar mazināšanas plānu ir vadība, nevis trauksme. Sarkans kļūst projekts, kurā risks ir, bet neviens nav pierakstījis, ko ar to darīt.' },
        { kind: 'p', text: 'Projekts ar sarkanu RAG nonāk blokā «Nepieciešama uzmanība», un rindas izvēršana paskaidro iemeslu: cik ir kavēts, cik ir augstu risku, vai budžets ir pārtērēts.' },
      ],
    },
    {
      id: 'delta',
      title: 'Δ dienas — novirze no bāzes plāna',
      blocks: [
        { kind: 'p', text: 'Kolonna atbild uz vienu jautājumu: cik tālu projekta fināls ir aizbraucis salīdzinājumā ar to, kā projekts tika plānots. Aprēķins ir divu datumu starpība: vēlākais plānotais beigu datums šodienas uzdevumos mīnus vēlākais plānotais beigu datums pēdējā bāzes plāna momentuzņēmumā. Pluss — termiņš aizgājis pa labi, mīnuss — ejam ar apsteigumu.' },
        { kind: 'note', tone: 'warn', text: 'Kolonna ir tukša, kamēr projektā nav noņemts bāzes plāns. Tā nav kļūda: nav ar ko salīdzināt — momentuzņēmums ir vienīgā atmiņa par to, kāds termiņš bija sākotnēji. Bez momentuzņēmuma projekta rindā ir domuzīme.' },
        { kind: 'p', text: 'Domuzīme parādīsies arī tad, ja:' },
        {
          kind: 'ul',
          items: [
            'momentuzņēmumā nevienam uzdevumam nav aizpildīts plānotais beigu datums;',
            'šodien projektā nav neviena uzdevuma ar plānoto beigu datumu (atceltie neskaitās);',
            'datumi ierakstīti neizlasāmā veidā — tad portāls godīgi rāda tukšumu, nevis nulli.',
          ],
        },
        {
          kind: 'steps',
          items: [
            { title: 'Sagaidiet saskaņotu plānu', text: 'Momentuzņēmums tiek ņemts no pašreizējās darbu struktūras, tāpēc to ir vērts noņemt, kad termiņi ir saskaņoti: tas kļūs par atskaites punktu.' },
            { title: 'Atveriet cilni «Bāzes plāns»', text: 'Tajā projektā, kuram nepieciešama kolonna Δ dienas.' },
            { title: 'Nospiediet «Fiksēt versiju»', text: 'No šī brīža portfelis rādīs nobīdi dienās, un tā augs pati, uzdevumus pārceļot.' },
          ],
        },
        { kind: 'note', tone: 'info', text: 'Salīdzinājums notiek ar PĒDĒJO momentuzņēmumu. Noņemts jauns bāzes plāns — atskaite sākas no jauna un Δ atgriežas nullē; iepriekšējās versijas paliek cilnes vēsturē.' },
      ],
    },
    {
      id: 'charts',
      title: 'No kurienes grafiki ņem datus',
      blocks: [
        { kind: 'p', text: 'Riņķa diagrammas augšā, «Projektu pabeigšanas termiņi» un «Projektu vadītāju noslodze» tiek rēķinātas no tā paša projektu saraksta, kas tabula, — tātad tās pakļaujas filtriem un meklēšanai virs saraksta. Sašaurinājāt portfeli līdz vienam projektu veidam — sašaurināsies arī šo grafiku skaitļi. Kuras diagrammas rādīt, katrs izvēlas pats: saite «Konfigurēt diagrammas» virs tām, izvēle tiek saglabāta kontā.' },
        {
          kind: 'table',
          head: ['Grafiks', 'Kas tajā tiek skaitīts'],
          rows: [
            ['Pēc statusa / pēc veida / pēc prioritātes', 'Vienkārša projektu pārskaitīšana pēc pases vērtības. Projekti bez veida ir apvienoti daļā «Bez veida».'],
            ['Pēc RAG statusa', 'Projektu pārskaitīšana pēc aprēķinātās krāsas (skat. sadaļu augstāk). Centrā — sarkano skaits.'],
            ['Portfeļa uzdevumi', 'Summa pa visiem projektiem: izpildīts, kavēts, pārējais — «darbā». Fāzes netiek skaitītas.'],
            ['Atvērtie riski', 'Atvērto augsto un vidējo risku summa. Zemie riņķa diagrammā apzināti nenonāk — tie neietekmē RAG.'],
            ['Portfeļa budžets', 'Visu projektu izdevumu pozīciju plāna un fakta summa. Daļa «Fakts» kļūst sarkana, kad fakts pārsniedz plānu.'],
            ['Kopējais statuss', 'Nepabeigto projektu vidējā veselība, «no 100».'],
            ['Projektu pabeigšanas termiņi', 'Projekti tiek sadalīti pēc plānotā beigu CETURKŠŅA gadu uz priekšu; viss, kas ir pirms šodienas, nonāk stabiņā «kavēts», viss, kas tālāk par gadu, — «vēlāk». Nospiežot uz stabiņa, parādās šī perioda projektu saraksts: kods, nosaukums, vadītājs, datums. Slēgtie projekti un projekti bez beigu datuma netiek rādīti.'],
            ['Portfeļa tendences', 'Vienīgais bloks, kas tiek rēķināts nevis «tagad», bet pēc ikdienas momentuzņēmumiem: reizi diennaktī portāls pieraksta, cik bija sarkano/dzelteno/zaļo, cik bija kavēts un cik uzdevumu izpildīts. Tāpēc vēsture parādās nevis uzreiz, un filtri to neietekmē.'],
          ],
        },
        { kind: 'note', tone: 'info', text: '«Projektu reģistra» rindas (tās, kas vēl nav izveidotas) tiek skaitītas tajās riņķa diagrammās, kur tām ir īsti dati: pēc projekta veida un pēc īpašnieka RAG novērtējuma. Diagrammās «Pēc statusa» un «Pēc prioritātes» tām ir sava daļa «vēl nav izveidoti» — statusa un prioritātes tām nav, un izdomāt tos būtu negodīgi. Uz uzdevumiem, riskiem, budžetu un vidējo veselību tās neietekmē: darbs pie tām vēl nav sācies.' },
        { kind: 'note', tone: 'info', text: '«Izpildītāju noslodze» ir izņēmums: tā tiek rēķināta pēc visiem jums pieejamajiem projektiem un portfeļa filtriem nepakļaujas, jo atbild uz jautājumu «kurš ir aizbērts» visā uzņēmumā. Tiek rādīti pirmie 12 cilvēki pēc atvērto uzdevumu skaita.' },
      ],
    },
    {
      id: 'overload',
      title: 'Ko nozīmē «pārslogots»',
      blocks: [
        { kind: 'p', text: 'Atzīme «Pārslogots» ir divos dažādos grafikos un nozīmē tajos dažādas lietas — tās ir divas atbildes uz dažādiem jautājumiem.' },
        {
          kind: 'table',
          head: ['Grafiks', 'Kas ir viena rinda', 'Kad ir «pārslogots»'],
          rows: [
            ['Izpildītāju noslodze', 'Cilvēks un viņa atvērtie uzdevumi visā portfelī (izpildītie, atceltie un fāzes neskaitās)', 'Atvērtu uzdevumu ir 8 vai vairāk VAI kopējā darbietilpības aplēse ir 80 stundas vai vairāk'],
            ['Projektu vadītāju noslodze', 'Vadītājs, viņa nepabeigtie projekti un viņam piesaistītās reģistra rindas («0 +3» — vada nulli, vēl trīs jāizveido; pelēkā joslas daļa ir tieši tās)', 'Kopā 4 projekti vai vairāk VAI vismaz viens IZVEIDOTS projekts ir sarkans. Sarkans novērtējums vēl neizveidotam projektam ir iemesls sarunai, bet ne šodienas noslodze'],
          ],
        },
        { kind: 'note', tone: 'warn', text: 'Aplēse stundās ir aizpildīta ne tuvu visiem uzdevumiem. Tur, kur tās nav, nostrādā tikai noteikums pēc uzdevumu skaita — proti, cilvēks ar pieciem ļoti smagiem uzdevumiem par pārslogotu neizskatīsies. Tas ir datu, nevis aprēķina ierobežojums: stundas plānā uztur ne visi.' },
        { kind: 'p', text: 'Abas atzīmes ir iemesls paskatīties, nevis spriedums: 8 nelieli atbalsta uzdevumi un 8 ieviešanas uzdevumi ir dažādas dzīves. Sliekšņus nosaka portfeļa vadītājs sadaļā «Iestatījumi» → «Pārslodzes sliekšņi»: atvērtie uzdevumi, aplēses stundas un projektu skaits vadītājam. Noklusējuma vērtības — 8 uzdevumi, 80 stundas, 4 projekti.' },
      ],
    },
  ],
}

import type { WikiPage } from '../types'

export const myWorkPage: WikiPage = {
  slug: 'my-work',
  title: 'Mani uzdevumi, kalendārs un paziņojumi',
  summary: 'Personīgais griezums: kas uzticēts man, kas deg un kas gaidāms.',
  group: 'portal',
  appRoute: () => '/my-work',
  sections: [
    {
      id: 'my-tasks',
      title: 'Mani uzdevumi',
      blocks: [
        { kind: 'p', text: 'Sadaļa savāc no visiem pieejamajiem projektiem to, kas uzticēts personīgi jums, un sagrupē pa projektiem. Tie nav tikai uzdevumi: portāls meklē jūsu vārdu visās sadaļās, kur ierakstam ir atbildīgais.' },
        {
          kind: 'table',
          head: ['Kas nonāk sarakstā', 'Pēc kādas pazīmes'],
          rows: [
            ['Darbu plāna uzdevums', 'Jūs esat izpildītājs.'],
            ['Backlog punkts', 'Jūs esat izpildītājs.'],
            ['Risks', 'Jūs esat riska atbildīgais.'],
            ['Lēmums', 'Jūs esat norādīts laukā «Kurš pieņēma».'],
            ['Pieņēmums', 'Jūs esat pieņēmuma atbildīgais.'],
            ['Komunikāciju plāna punkts', 'Jūs esat par to atbildīgais.'],
            ['Komandas vai ieinteresētās puses rinda', 'Jūs esat projekta sastāvā.'],
            ['Sanāksme', 'Jūs esat starp dalībniekiem.'],
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Portāls jūs atpazīst pēc cilvēka no kataloga. Ja izpildītāja vai atbildīgā laukā ir brīvs teksts — «PV», «IT nodaļa», uzvārds ar drukas kļūdu, — ieraksts netiek ne ar vienu sasaistīts un šeit neparādīsies. No malas tāda rinda izskatās normāla, tāpēc kļūdu parasti pamana tad, kad cilvēks saka, ka nav redzējis nevienu uzdevumu.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ja sadaļa ir tukša, jums pagaidām nekas nav uzticēts. Portfeļa vadītāja lomā tas ir normāli: skats pāri projektiem tur saucas «Portfolio».',
        },
        { kind: 'shot', src: '/wiki-shots/my-work.png', alt: 'Sadaļa «Mani uzdevumi» ar man uzticēto ierakstu sarakstu' },
      ],
    },
    {
      id: 'filters',
      title: 'Filtri un saraksta caurskatīšana',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Meklēšana — pēc nosaukuma, uzreiz pa visiem projektiem.',
            'Atvērtie / slēgtie / visi: pēc noklusējuma rāda tikai neslēgtos ierakstus, lai saraksts neaugtu bezgalīgi.',
            'Tikai aktīvie projekti vai visi: pabeigtie un atceltie projekti pēc noklusējuma ir paslēpti.',
            'Tipu slēdži — izslēdziet riskus un ieinteresētās puses, ja šodien skatāt tikai uzdevumus.',
            'Projektus var sakļaut pa vienam vai visus uzreiz ar pogu «Sakļaut visu».',
          ],
        },
        { kind: 'p', text: 'Projekta nosaukums grupas galvenē ne vienmēr ir saite: projekts atvērsies tikai tad, ja esat tā vadītājs, līdzvadītājs vai portfeļa vadītājs. Komandas dalībniekam redzami viņa paša ieraksti, bet ne viss projekts — tā ir atšķirība starp «darbs ir uz manis» un «es vadu projektu».' },
      ],
    },
    {
      id: 'calendar',
      title: 'Kalendārs',
      blocks: [
        { kind: 'p', text: 'Darbu datumi un sanāksmes vienā režģī. Skati — mēnesis, nedēļa un diena ar sadalījumu pa stundām; nolaižamais saraksts kreisajā pusē atstāj vienu projektu.' },
        { kind: 'p', text: 'No portāla šeit nonāk darbu plāna uzdevumi un backlog punkti, kas uzticēti jums un kuriem ir datumi. Ieraksts bez datumiem kalendārā neparādīsies — to jāmeklē sadaļā «Mani uzdevumi». Pabeigtie un atceltie projekti kalendārā neiet.' },
        { kind: 'p', text: 'Virsū uzklājas jūsu Bitrix24 kalendāra notikumi — tā redzams, kurš darba laiks jau ir aizņemts. Ja tie traucē un vajadzīgs skats tikai pa projektiem, noņemiet ķeksīti «Bitrix notikumi»: izvēle tiek iegaumēta.' },
      ],
    },
    {
      id: 'attention',
      title: 'Paziņojumi',
      blocks: [
        { kind: 'p', text: 'Zvaniņš kreisās izvēlnes augšpusē skatās plašāk nekā «Mani uzdevumi»: tas savāc to, kam vērts pievērst uzmanību, pa visiem jūsu nepabeigtajiem projektiem — neatkarīgi no tā, kam darbs uzticēts.' },
        {
          kind: 'table',
          head: ['Grupa', 'Kad tur nonāk'],
          rows: [
            ['Nokavēts', 'Termiņš pagājis, bet uzdevums nav ne pabeigts, ne atcelts.'],
            ['Drīz termiņš', 'Līdz plānotajām beigām nedēļa vai mazāk.'],
            ['Stāv uz vietas', 'Uzdevums ir izpildē, progress joprojām 0%, bet sākt to vajadzēja vairāk nekā pirms nedēļas.'],
            ['Dotie uzdevumi', 'Sanāksmes uzdevums ar termiņu tuvākajā nedēļā vai jau nokavēts.'],
            ['Tuvākās sanāksmes', 'Tikšanās tuvāko septiņu dienu laikā.'],
            ['Bez datumiem', 'Atvērts uzdevums, kuram nav ne sākuma, ne beigu datuma.'],
          ],
        },
        { kind: 'p', text: 'Klikšķis uz rindas ved tieši uz vajadzīgo projekta sadaļu. Skaitlis uz zvaniņa ir neizlasīto daudzums; poga «Atzīmēt visu kā izlasītu» to nodzēš līdz nākamajam jaunumam. Izlasītais tiek iegaumēts pārlūkā, tāpēc citā datorā skaitītājs var atšķirties.' },
        { kind: 'note', tone: 'tip', text: 'Tukšs zvaniņš ne vienmēr ir laba zīme. Projektam bez ievadītiem datumiem kavējumam nav no kurienes rasties: klusums šeit nozīmē vai nu kārtību, vai neaizpildītu darbu plānu.' },
      ],
    },
  ],
}

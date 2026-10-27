import type { WikiPage } from '../types'

export const rolesPage: WikiPage = {
  slug: 'roles',
  title: 'Lomas un tiesības',
  summary: 'Kāpēc dažādi cilvēki portālā redz dažādas lietas.',
  group: 'start',
  sections: [
    {
      id: 'two-roles',
      title: 'Divas lomas',
      blocks: [
        { kind: 'p', text: 'Portālā ir tikai divas lomas, un atšķirība starp tām ir tvērumā, nevis tajā, «kurš ir galvenāks».' },
        {
          kind: 'table',
          head: ['Loma', 'Ko redz un ko var'],
          rows: [
            ['Projekta vadītājs', 'Savus projektus (kur ir PV vai līdzvadītājs) — pilnībā un ar tiesībām tos labot. Citu cilvēku projektus neredz nemaz.'],
            ['Portfeļa vadītājs', 'Visus uzņēmuma projektus, kā arī sadaļas «Portfolio» un «Iestatījumi». Var labot jebkuru projektu un izveidot lietotājus.'],
          ],
        },
      ],
    },
    {
      id: 'co-pm',
      title: 'Līdzvadītājs',
      blocks: [
        { kind: 'p', text: 'Ar projektu var dalīties: līdzvadītājs iegūst uz šo projektu tādas pašas tiesības kā galvenais vadītājs. Līdzvadītāju pievieno projekta galvenē — turpat, kur ir «Nodot VP».' },
        { kind: 'p', text: 'Līdzvadītāju sastāvu var pārvaldīt tikai galvenais PV vai portfeļa vadītājs.' },
      ],
    },
    {
      id: 'can',
      title: 'Kurš ko var',
      blocks: [
        {
          kind: 'table',
          head: ['Darbība', 'Projekta vadītājs', 'Līdzvadītājs', 'Portfeļa vadītājs'],
          rows: [
            ['Izveidot projektu', 'jā', 'jā', 'jā'],
            ['Labot savu projektu', 'jā', 'jā', 'jā'],
            ['Redzēt svešu projektu', 'nē', 'nē', 'jā'],
            ['Pievienot līdzvadītāju', 'jā', 'nē', 'jā'],
            ['Nodot projektu citam vadītājam', 'jā', 'nē', 'jā'],
            ['Arhivēt projektu', 'jā', 'jā', 'jā'],
            ['Publiskā saite un palīga slēdzene', 'jā', 'jā', 'jā'],
            ['Portfolio un Iestatījumi', 'nē', 'nē', 'jā'],
            ['Veidot lietotājus un cilvēku katalogu', 'nē', 'nē', 'jā'],
          ],
        },
        { kind: 'p', text: 'Projekta nodošana ir galvenā vadītāja maiņa: iepriekšējais zaudē piekļuvi, ja vien nav atstāts par līdzvadītāju. Vārda maiņa profilā pārraksta parakstu «Projekta vadītājs» visos viņa projektos uzreiz.' },
        { kind: 'note', tone: 'warn', text: 'Arhivēšana paslēpj projektu no jūsu saraksta, un atgriezt to var tikai portfeļa vadītājs — projektu sarakstā filtra «rādīt arhīvu» nav vispār. Pirms arhivēšanas saglabājiet saiti uz projektu vai brīdiniet portāla īpašnieku.' },
      ],
    },
    {
      id: 'why-empty',
      title: 'Kāpēc man ir tukšs',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Projektu saraksts ir tukšs — jums pagaidām nav piešķirts neviens projekts. Izveidojiet savu vai palūdziet pievienot jūs kā līdzvadītāju.',
            '«Mani uzdevumi» ir tukši — personīgi jums nav piešķirts neviens uzdevums. Portfeļa vadītājam tas ir normāli.',
            'Nav sadaļas «Portfolio» vai «Iestatījumi» — tās ir tikai portfeļa vadītājam.',
            'Portāls rāda tikai 2FA iestatīšanas logu — beidzies termiņš tās pieslēgšanai (septiņas dienas no pirmās ieiešanas). Pieslēdziet, un piekļuve atgriezīsies.',
            '«Mani uzdevumi» ir tukši, lai gan uzdevumi jums ir, — uzdevumos izpildītājs ierakstīts ar tekstu, nevis izvēlēts no kataloga. Portāls atpazīst cilvēku tikai caur katalogu.',
            'Projekts pazuda no saraksta — tas ir arhivēts vai nodots citam vadītājam.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Kā parādīt projektu tiem, kam nav piekļuves',
      blocks: [
        { kind: 'p', text: 'Poga «Kopīgot» projekta galvenē izveido publisku saiti — pa to projektu var apskatīt, nepiesakoties portālā. Rādāmās sadaļas var izvēlēties: var atvērt tikai pasi un plānu, nerādot budžetu.' },
        { kind: 'note', tone: 'warn', text: 'Saite darbojas ikvienam, kas to ir saņēmis. Cilvēku kontakti publiskajā lapā ir paslēpti, bet pārējais ir redzams — nepublicējiet to tur, kur nevajag.' },
      ],
    },
  ],
}

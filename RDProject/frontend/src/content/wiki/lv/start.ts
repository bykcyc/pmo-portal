import type { WikiPage } from '../types'

export const startPage: WikiPage = {
  slug: 'start',
  title: 'Ar ko sākt',
  summary: 'Pirmā pieteikšanās, divfaktoru autentifikācija un minimums, ar kuru projekts jau ir dzīvs.',
  group: 'start',
  sections: [
    {
      id: 'login',
      title: 'Pirmā pieteikšanās',
      blocks: [
        { kind: 'p', text: 'Portāls atveras jūsu instalācijas adresē. Pieteikšanās vārdu un paroli izsniedz portfeļa vadītājs.' },
        {
          kind: 'steps',
          items: [
            { title: 'Pieteikieties', text: 'Pieteikšanās vārds ir jūsu darba e-pasts, parole — tā, kuru jums izsniedza.' },
            { title: 'Pieslēdziet divfaktoru autentifikāciju', text: 'Portāls to palūgs pats: noskenējiet QR kodu ar autentifikatora lietotni (Google Authenticator, Microsoft Authenticator, 1Password) un ievadiet sešciparu kodu.' },
            { title: 'Nomainiet paroli', text: 'Sadaļa «Profils». Izsniegto paroli zināt ne tikai jūs, tāpēc to labāk aizstāt ar savu.' },
          ],
        },
        {
          kind: 'note',
          tone: 'warn',
          text: 'Divfaktoru autentifikācija ir obligāta. Tās pieslēgšanai pēc pirmās pieteikšanās ir dažas dienas; kad termiņš beigsies, portāls vairs nerādīs datus un atvērsies tikai 2FA iestatīšanas logs. Tas nav bojājums — vienkārši pieslēdziet to, un piekļuve atgriezīsies.',
        },
      ],
    },
    {
      id: 'minimum',
      title: 'Minimums, ar kuru projekts ir dzīvs',
      blocks: [
        { kind: 'p', text: 'Visas sadaļas uzreiz aizpildīt nav jāsteidzas. Pietiek ar divām, pārējo pievienosiet darba gaitā.' },
        {
          kind: 'steps',
          items: [
            { title: 'Izveidojiet projektu', text: 'Poga «Izveidot projektu» sadaļā «Projekti». Pirmajā solī vajadzīgs tikai nosaukums — projekta kodu portāls piešķirs pats.' },
            { title: 'Aizpildiet pasi', text: 'Mērķis, vadītājs un plānotā pabeigšana. Tas ir minimums, bez kura projektu nevar apspriest.' },
            { title: 'Uzskaitiet uzdevumus', text: 'Sadaļa «Darbu sadalījums (WBS)»: kas jāizdara, līdz kuram datumam un kurš par to atbild.' },
          ],
        },
        { kind: 'note', tone: 'tip', text: 'Gantu atsevišķi zīmēt nevajag — tas veidojas no uzdevumiem ar datumiem. Tāfele arī: tas ir tas pats saraksts, izkārtots pa statusiem.' },
      ],
    },
    {
      id: 'next',
      title: 'Ko pievienot vēlāk',
      blocks: [
        {
          kind: 'table',
          head: ['Sadaļa', 'Kam tā vajadzīga'],
          rows: [
            ['Komanda un lomas', 'Kas piedalās un kurš par ko atbild'],
            ['Risku reģistrs', 'Kas var noiet greizi un kurš to uzrauga'],
            ['Lēmumu žurnāls', 'Kāpēc izdarīts tieši tā, nevis citādi — pēc pusgada tas izglābj'],
            ['Budžets', 'Plāns un fakts pa mēnešiem'],
            ['Sanāksmes', 'Darba kārtība, lēmumi un uzdevumi — nekas nepazūd'],
            ['Statusa atskaite', '10 minūtes nedēļā, un vadība ir lietas kursā bez zvaniem'],
          ],
        },
        { kind: 'p', text: 'Katrā sadaļā ir poga «Kā lietot» — īsa instrukcija tieši par šo lapu. Bet panelis «Šajā lapā» labajā pusē pasaka priekšā, kas projektam šobrīd pietrūkst.' },
      ],
    },
    {
      id: 'help',
      title: 'Ja kaut kas nav kārtībā',
      blocks: [
        { kind: 'p', text: 'Portāls vēl tiek pilnveidots, un kaut kas var strādāt savādāk vai šķist neērts. Tas ir normāli, un par to ir vērts ziņot.' },
        { kind: 'p', text: 'Kreisās izvēlnes apakšā ir poga «Ziņot par problēmu». Aprakstiet, kas notika — portāls pievienos ekrānuzņēmumu, un piezīme aizies tieši pie izstrādātāja.' },
      ],
    },
  ],
}

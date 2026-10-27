/** Снимает DOM-элемент в PDF (A4), разбивая длинный контент на страницы. */
export async function exportElementToPdf(el: HTMLElement, filename: string): Promise<void> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ])
  // html2canvas снимает живой DOM: в тёмной теме фон получается тёмным.
  // Принудительно снимаем в светлой теме, затем восстанавливаем исходную.
  const wasDark = document.documentElement.classList.contains('dark')
  if (wasDark) document.documentElement.classList.remove('dark')
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
    const img = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pdf.internal.pageSize.getWidth()
    const imgH = (canvas.height * imgW) / canvas.width
    let remaining = imgH
    let position = 0
    pdf.addImage(img, 'PNG', 0, position, imgW, imgH)
    remaining -= pageH
    while (remaining > 0) {
      position -= pageH
      pdf.addPage()
      pdf.addImage(img, 'PNG', 0, position, imgW, imgH)
      remaining -= pageH
    }
    pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
  } finally {
    if (wasDark) document.documentElement.classList.add('dark')
  }
}

import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { exportRowsToXlsx } from '@/utils/exportXlsx'
import { Button } from '@/components/ui/button'

/** Кнопка экспорта произвольных строк реестра в XLSX. Прячется, если строк нет. */
export default function ExportXlsxButton({
  rows, filename, label,
}: {
  rows: Record<string, unknown>[]
  filename: string
  label?: string
}) {
  const { t } = useTranslation()
  if (!rows || rows.length === 0) return null
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => void exportRowsToXlsx(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, rows)}
      icon={<Download size={14} />}
    >
      {label ?? t('common.export', { defaultValue: 'Экспорт' })}
    </Button>
  )
}

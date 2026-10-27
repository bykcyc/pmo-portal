import { Info, Lightbulb, TriangleAlert } from 'lucide-react'
import type { WikiBlock, WikiSection } from '@/content/wiki/types'

const NOTE_STYLE = {
  info: { cls: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200', Icon: Info },
  tip: { cls: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200', Icon: Lightbulb },
  warn: { cls: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100', Icon: TriangleAlert },
} as const

function Block({ block }: { block: WikiBlock }) {
  switch (block.kind) {
    case 'p':
      return <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{block.text}</p>

    case 'ul':
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )

    case 'ol':
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      )

    case 'note': {
      const { cls, Icon } = NOTE_STYLE[block.tone]
      return (
        <div className={`flex gap-2 rounded-xl border px-3 py-2.5 text-sm leading-relaxed ${cls}`}>
          <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{block.text}</span>
        </div>
      )
    }

    case 'table':
      // Широкие таблицы скроллятся внутри себя, а не растягивают страницу.
      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                {block.head.map((h, i) => (
                  <th key={i} className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  {row.map((cell, j) => (
                    <td key={j} className="py-2 pr-4 align-top text-slate-700 dark:text-slate-300">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'steps':
      return (
        <ol className="space-y-3">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-btn-primary text-xs font-semibold text-btn-primary-fg">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.title}</p>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )

    case 'shot':
      return (
        <figure className="space-y-1.5">
          {/* Скриншоты лежат в public/wiki-shots и НЕ попадают в js-бандл. loading="lazy" —
              на странице их может быть несколько, а весят они сотни килобайт. */}
          <img
            src={block.src}
            alt={block.alt}
            loading="lazy"
            className="w-full rounded-xl border border-slate-200 shadow-sm dark:border-slate-700"
          />
          {block.caption && (
            <figcaption className="text-xs text-slate-500 dark:text-slate-400">{block.caption}</figcaption>
          )}
        </figure>
      )
  }
}

/** Те же блоки без обёртки в раздел — для «Новостей», где заголовком служит
 *  сама новость. Один рендерер на справку и новости: одна проверенная вёрстка
 *  в светлой и тёмной теме и ни одного нового способа вставить произвольный HTML. */
export function ContentBlocks({ blocks }: { blocks: WikiBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  )
}

export default function WikiRenderer({ sections }: { sections: WikiSection[] }) {
  return (
    <div className="space-y-8">
      {sections.map(section => (
        // scroll-mt: якорь иначе уезжает под липкую шапку страницы
        <section key={section.id} id={section.id} className="scroll-mt-24 space-y-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{section.title}</h2>
          {section.blocks.map((b, i) => <Block key={i} block={b} />)}
        </section>
      ))}
    </div>
  )
}

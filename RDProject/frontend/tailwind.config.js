/** @type {import('tailwindcss').Config} */

// Тема через CSS-переменные (Warm/Classic): var-изированы ТОЛЬКО семейства, чьи значения
// различаются между темами — slate, gray, blue(+primary), amber, yellow. Статусные семейства
// (rose/red/green/emerald/sky/orange/…) — сток: это семантика состояний, в обеих темах одинаковая.
// Значения переменных лежат в src/index.css (:root = Warm, .theme-classic = сток Tailwind);
// формат — ГОЛЫЕ RGB-триплеты («58 59 64»), иначе rgb(… / alpha) молча ломается.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const ramp = (family) =>
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${family}-${s}) / <alpha-value>)`]))

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // font-sans следует теме: Warm — Manrope, Classic — Inter/Segoe (см. --font-sans)
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      colors: {
        slate: ramp('slate'),
        gray: ramp('gray'),
        blue: ramp('blue'),
        amber: ramp('amber'),
        yellow: ramp('yellow'),
        // sky — «подсветочные» поверхности (Surface accent, info-тост): в тёплой теме это кремово-золотой
        // тинт (#F4EFD6), холодно-голубые островки в тёплой теме — чужие.
        sky: ramp('sky'),
        // Кнопка primary — ИМЕНОВАННЫЕ токены (не bg-[var(…)]: неоднозначность Tailwind +
        // twMerge-группировка). Полные цвета, без alpha-модификаторов — они тут не нужны.
        'btn-primary': {
          DEFAULT: 'var(--btn-primary-bg)',
          fg: 'var(--btn-primary-fg)',
          hover: 'var(--btn-primary-hover)',
        },
        // primary — исторический алиас blue, НАМЕРЕННО только 6 исходных шейдов:
        // primary-200/300/400/800/950 в коде есть, но никогда не были определены (классы молча
        // пустые) — напр. border-primary-200 на add-row в 8 вкладках рендерится дефолтным серым.
        // Определить их = молча перекрасить эти места даже в Classic (сломать пиксельный паритет).
        primary: {
          50: 'rgb(var(--c-blue-50) / <alpha-value>)',
          100: 'rgb(var(--c-blue-100) / <alpha-value>)',
          500: 'rgb(var(--c-blue-500) / <alpha-value>)',
          600: 'rgb(var(--c-blue-600) / <alpha-value>)',
          700: 'rgb(var(--c-blue-700) / <alpha-value>)',
          900: 'rgb(var(--c-blue-900) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}

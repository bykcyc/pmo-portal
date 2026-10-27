// Анти-FOUC: тема и семейство оформления ставятся ДО загрузки React.
// Warm = отсутствие класса (дефолт), Classic = класс theme-classic.
//
// Почему ОТДЕЛЬНЫМ файлом, а не инлайном в index.html: боевой Caddy отдаёт
// Content-Security-Policy со `script-src 'self'`, и инлайн-скрипт там просто
// не выполнялся — у всех, кто выбрал тёмную тему или Classic, на каждой
// загрузке моргал светлый Warm. Хэш в CSP не годится: он ломается при
// любой правке скрипта, причём молча и только на проде.
//
// Скрипт обязан оставаться КЛАССИЧЕСКИМ и БЕЗ defer/async — иначе он выполнится
// после отрисовки, то есть ровно тогда, когда мигание уже произошло.
// Лежит в public/: Vite копирует такие файлы в корень сборки как есть.
(function () {
  try {
    var stored = localStorage.getItem('pm-tool-ui')
    if (stored) {
      var data = JSON.parse(stored)
      if (data && data.state) {
        if (data.state.theme === 'dark') {
          document.documentElement.classList.add('dark')
        }
        if (data.state.skin === 'classic') {
          document.documentElement.classList.add('theme-classic')
        }
      }
    }
  } catch (e) {}
})()

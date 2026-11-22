'use strict';
/* Генерация иконок приложения (icon.ico для exe, tray.png для трея) без внешних зависимостей
   Запуск: python3 scripts/gen_assets.py  (см. README) — здесь только проверка наличия */
const fs = require('fs');
const path = require('path');
const need = ['build/icon.ico', 'renderer/assets/tray.png'];
let ok = true;
for (const f of need) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) { console.log('нет файла:', f); ok = false; }
}
console.log(ok ? 'Иконки на месте' : 'Сгенерируйте иконки скриптом scripts/gen_assets.py');
process.exit(ok ? 0 : 1);

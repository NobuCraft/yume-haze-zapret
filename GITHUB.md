# Как выложить проект на GitHub

Проект — только наш код (GUI-оболочка). Чужого софта внутри нет: Zapret и TG WS Proxy
скачиваются с GitHub Flowseal при установке. Поэтому лицензию MIT ставим спокойно.

Ниже — два пути: быстрый через сайт и нормальный через терминал.

---

## Путь 1. Через сайт GitHub (без терминала)

1. Зайти на github.com → **New repository**.
2. Имя: `yume-haze-zapret`. Описание: `GUI для Zapret и TG WS Proxy (Electron, Windows)`.
3. **Public** (если хотите, чтобы репозиторий видели) или Private.
4. **Create repository**.
5. На странице пустого репозитория — ссылка **uploading an existing file**.
6. Перетащить туда содержимое папки `yume-haze/` (не саму папку, а её содержимое:
   `main.js`, `preload.js`, `src/`, `renderer/`, `scripts/`, `res/`, `tests/`, `package.json`,
   `README.md`, `LICENSE`, `.gitignore`).
   > `node_modules` и `release` загружать не нужно — они в `.gitignore`.
7. Commit message: `Yume Haze Zapret 2.1.2`, нажать **Commit changes**.

Установщик (81 МБ) в репозиторий **не кладём** — он идёт в раздел **Releases**:

8. Вкладка **Releases** → **Create a new release** → Tag: `v2.1.2`
9. Заголовок: `Yume Haze Zapret 2.1.2`, в описании — список изменений (см. `CHANGELOG.md`).
10. Прикрепить файл `YumeHazeZapret-2.1.2-setup.exe` в раздел «Attach binaries».
11. **Publish release**.

---

## Путь 2. Через терминал (git)

```bash
cd yume-haze

git init
git add .
git status                 # проверить: node_modules и release не должны попасть

git commit -m "Yume Haze Zapret 2.1.2"

# свой репозиторий (замените USERNAME на свой логин)
git remote add origin https://github.com/USERNAME/yume-haze-zapret.git
git branch -M main
git push -u origin main
```

Если GitHub просит пароль — нужен **Personal Access Token**
(Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token,
права `repo`). Вставлять его вместо пароля при `git push`.

Тег для релиза:

```bash
git tag -a v2.1.2 -m "Yume Haze Zapret 2.1.2"
git push origin v2.1.2
```

Дальше на сайте: **Releases → Draft a new release → выбрать тег v2.1.2 → прикрепить
`YumeHazeZapret-2.1.2-setup.exe` → Publish**.

---

## Что подготовлено в проекте

| Файл | Назначение |
|---|---|
| `.gitignore` | исключает `node_modules/`, `release/`, `dist/`, `*.log` |
| `LICENSE` | MIT — наш код свободно копировать и менять |
| `CHANGELOG.md` | история версий (2.1.0 → 2.1.2) |
| `README.md` | описание, быстрый старт, структура, FAQ |

## Важно про упоминание Flowseal

* В README есть ссылки на `github.com/Flowseal/zapret-discord-youtube` и
  `github.com/Flowseal/tg-ws-proxy` — это нормально: мы указываем автора и источник.
* Не нужно копировать в наш репозиторий чужие `.exe`, `.sys`, `.dll` и `.bat`-стратегии —
  приложение качает официальный релиз само.
* Если хотите подчеркнуть, что проект неофициальный, добавьте в README строку:
  «Неофициальная оболочка. Все права на Zapret принадлежат bol-van и Flowseal,
  на TG WS Proxy — Flowseal, на WinDivert — basil00.»

## Права и риски

* Обход блокировок в РФ может трактоваться как нарушение — это на вашей ответственности;
  в README лучше не писать «обход блокировок Роскомнадзора», достаточно «для доступа
  к сервисам, которые не работают напрямую».
* MIT-лицензия снимает с автора ответственность за использование.

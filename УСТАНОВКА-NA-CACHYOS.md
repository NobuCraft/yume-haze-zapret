# Yume Haze Zapret 2.3.0 — установка на CachyOS

## Что скачать

В папке `release/` лежат три файла — они одинаковые по содержимому, отличаются только упаковкой:

| Файл | Размер | Кому |
|---|---|---|
| `YumeHazeZapret-2.3.0-x86_64.AppImage` | 104 МБ | проще всего: один файл, ничего ставить не надо |
| `YumeHazeZapret-2.3.0-amd64.deb` | 72 МБ | Debian/Ubuntu (Arch его **не** понимает) |
| `YumeHazeZapret-2.3.0-x64.tar.gz` | 98 МБ | распаковать в любую папку и запустить `yume-haze-zapret` |

На CachyOS берите **AppImage**.

## Шаг 1. Зависимости (один раз)

```bash
sudo pacman -S --needed nftables libnetfilter_queue gcc make
```

`hz-nfq` (движок обхода) уже собран и лежит внутри пакета — компилятор нужен только
если захотите пересобрать его сами: `make -C linux/engine`.

## Шаг 2. Запуск

```bash
chmod +x YumeHazeZapret-2.3.0-x86_64.AppImage
./YumeHazeZapret-2.3.0-x86_64.AppImage
```

Дальше всё в интерфейсе:

1. **Обновления → Установить** — приложение скачает релиз Flowseal 1.10.4 и разложит списки.
2. **Zapret → выбрать стратегию → кнопка питания**.
3. Первый запуск спросит пароль polkit — один раз, для правил `nftables` и запуска движка.
   Само приложение работает **без root**.
4. Отдельного окна терминала не открывается никогда: движок стартует фоном, лог пишется в
   `~/.config/Yume Haze Zapret/logs/`.

## Как проверить, что обход работает

```bash
sudo nft list table inet hzq        # должны быть цепочки out/pre и queue num 200
pgrep -a hz-nfq                     # движок запущен
curl -s -o /dev/null -w '%{http_code}\n' https://www.youtube.com
```

В приложении: **Тесты → Быстрый тест** — покажет доступность сайтов и Discord.

## Автозапуск при загрузке (по желанию)

**Zapret → Драйвер → Установить как службу** — создаст systemd-юнит
`yume-haze-zapret.service` (поднимает `nft`-правила и движок до входа в систему).

```bash
systemctl status yume-haze-zapret
sudo journalctl -u yume-haze-zapret -n 20
```

## Если что-то не так

| Симптом | Что делать |
|---|---|
| «nftables не найден» | `sudo pacman -S nftables` |
| «нужен pkexec» | `sudo pacman -S polkit` (в CachyOS обычно уже стоит) |
| сайты не открываются | смените стратегию в **Zapret → Стратегии**, начните с `general.bat` |
| Discord работает, YouTube нет | стратегия `general (ALT)` или `general (FAKE)` |
| ничего не помогло | **Журнал** в приложении + `~/.config/Yume Haze Zapret/engine.log` |

## Чем это отличается от Windows-версии

На Windows движок — `winws.exe` + драйвер WinDivert, он есть в релизе Flowseal.
Под Linux такого бинарника не существует, поэтому здесь **свой движок `hz-nfq`** на NFQUEUE:
он читает те же стратегии из `.bat`-файлов Flowseal (то есть 23 стратегии, а не «одна зашитая»),
те же списки `list-general.txt` / `list-exclude.txt` / `list-google.txt` и умеет
`multisplit`, `fake` + `repeats`, `split-pos`, `split-seqovl`, `ip-id=zero`, `cutoff`,
`any-protocol`, фильтры по L7 (`--filter-l7=discord,stun`).

TG WS Proxy в Linux-сборке недоступен (это Windows-бинарь) — раздел так и пишет.

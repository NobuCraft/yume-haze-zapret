#!/usr/bin/env bash
# Установка зависимостей Linux-движка Yume Haze Zapret (CachyOS/Arch, Debian/Ubuntu, Fedora)
set -euo pipefail

say() { printf '\033[35m›\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  say "нужны права root для установки пакетов"
  exec sudo "$0" "$@"
fi

if command -v pacman >/dev/null 2>&1; then
  say "Arch/CachyOS: ставлю libnetfilter_queue, nftables"
  pacman -S --needed --noconfirm libnetfilter_queue nftables base-devel
elif command -v apt-get >/dev/null 2>&1; then
  say "Debian/Ubuntu: ставлю libnetfilter-queue-dev, nftables"
  apt-get update -qq
  apt-get install -y build-essential libnetfilter-queue-dev nftables
elif command -v dnf >/dev/null 2>&1; then
  say "Fedora: ставлю libnetfilter_queue-devel, nftables"
  dnf install -y gcc make libnetfilter_queue-devel nftables
else
  warn "неизвестный пакетный менеджер — установите вручную: gcc, make, libnetfilter_queue, nftables"
  exit 1
fi

say "проверяю движок"
if [ -x "$(dirname "$0")/engine/hz-nfq" ]; then
  "$(dirname "$0")/engine/hz-nfq" --selftest
else
  warn "движок не собран: make -C $(dirname "$0")/engine"
fi

cat <<'TXT'

Готово. Что дальше:
  1. запустите Yume Haze Zapret (AppImage или из меню);
  2. раздел «Zapret» → «Обновления» → установить Zapret (скачает релиз Flowseal);
  3. включите защиту — приложение один раз спросит пароль polkit для nftables.

Проверка вручную:
  nft list table inet hzq      # активные правила обхода
  sudo hz-nfq --selftest       # самопроверка движка
TXT

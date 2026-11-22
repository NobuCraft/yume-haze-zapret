#!/usr/bin/env bash
# Скриншот собранного Windows-приложения (wine + Xvfb). Вспомогательный скрипт разработки.
set -u
cd "$(dirname "$0")/.." || exit 1
export WINEPREFIX=${WINEPREFIX:-$HOME/.winebuild}
export WINEDEBUG=-all
export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR" /home/user/shots

DISP=${DISP:-:77}
Xvfb "$DISP" -screen 0 1400x950x24 >/tmp/xvfb.log 2>&1 &
XPID=$!
sleep 3
export DISPLAY=$DISP

wine "release/win-unpacked/Yume Haze Zapret.exe" --no-sandbox --disable-gpu --disable-gpu-compositing --disable-direct-composition >/tmp/winapp-shot.log 2>&1 &
WPID=$!

for i in $(seq 1 20); do
  sleep 3
  N=$(xdotool search --name "Yume Haze" 2>/dev/null | wc -l)
  [ "$N" -gt 0 ] && echo "окно найдено через $((i*3)) с" && break
done
sleep 6
xdotool search --name "Yume Haze" getwindowgeometry 2>/dev/null | head -4
W=$(xdotool search --name "Yume Haze" | head -1); xdotool windowraise "$W"; sleep 2; import -display "$DISP" -window "$W" /home/user/shots/win-app.png && echo "скриншот: /home/user/shots/win-app.png"
ls -l /home/user/shots/win-app.png

kill $WPID 2>/dev/null
wineserver -k 2>/dev/null
kill $XPID 2>/dev/null

/* Yume Haze Zapret — метаданные стратегий zapret-discord-youtube 1.10.4
   Файл .bat запускается напрямую из папки zapret, поэтому аргументы всегда
   соответствуют установленной версии. Здесь хранится только описание для UI. */
'use strict';

const ZAPRET_VERSION = '1.10.4';

const STRATEGIES = [
  { file: 'general.bat', name: 'General', group: 'Basic',
    note: 'Базовая стратегия: multisplit + fake QUIC. Хороший старт почти на любом провайдере.',
    feats: ['multisplit', 'fake-quic', 'ip-id=zero'] },
  { file: 'general (ALT).bat', name: 'ALT', group: 'Basic',
    note: 'Fake TLS + HTTP, агрессивные повторы. Помогает там, где обычный split не проходит.',
    feats: ['fake+split', 'fooling=ts', 'fake-tls'] },
  { file: 'general (ALT2).bat', name: 'ALT2', group: 'Basic',
    note: 'Только multisplit со смещением 2 — мягкий вариант для чувствительных провайдеров.',
    feats: ['multisplit', 'split-pos=2'] },
  { file: 'general (ALT3).bat', name: 'ALT3', group: 'Basic',
    note: 'Fake с hostfakesplit: подмена хоста внутри сегмента.',
    feats: ['fake+split', 'hostfakesplit'] },
  { file: 'general (ALT4).bat', name: 'ALT4', group: 'Basic',
    note: 'fake + multisplit без fooling. Стабильно на сетях с TTL-фильтрацией.',
    feats: ['fake+split', 'multisplit'] },
  { file: 'general (ALT5).bat', name: 'ALT5', group: 'Basic',
    note: 'Минимальный набор: только fake QUIC, 14 повторов.',
    feats: ['fake-quic', 'repeats=14'] },
  { file: 'general (ALT6).bat', name: 'ALT6', group: 'Basic',
    note: 'multisplit, seqovl 681, позиция 1 — «классический» обход Discord/YouTube.',
    feats: ['multisplit', 'seqovl=681'] },
  { file: 'general (ALT7).bat', name: 'ALT7', group: 'Basic',
    note: 'multisplit с позицией sniext+1 — резка внутри SNI.',
    feats: ['multisplit', 'sniext+1'] },
  { file: 'general (ALT8).bat', name: 'ALT8', group: 'Basic',
    note: 'Fake TLS/HTTP/QUIC без разрезания — чистая подмена пакетов.',
    feats: ['fake-tls', 'fake-http'] },
  { file: 'general (ALT9).bat', name: 'ALT9', group: 'Basic',
    note: 'fooling=ts + hostfakesplit, без fake-tls.',
    feats: ['fooling=ts', 'hostfakesplit'] },
  { file: 'general (ALT10).bat', name: 'ALT10', group: 'Basic',
    note: 'Fake TLS с фейком 4pda.to, 12 повторов.',
    feats: ['fake-tls=4pda', 'repeats=12'] },
  { file: 'general (ALT11).bat', name: 'ALT11', group: 'Advanced',
    note: 'В 1.10.4 обновлён стандартный TLS-фейк (sferum). Часто лучший результат на МТС/Ростелеком.',
    feats: ['fake+multisplit', 'fooling=ts', 'repeats=8'] },
  { file: 'general (ALT12).bat', name: 'ALT12', group: 'Advanced',
    note: 'ALT11 + hostfakesplit. Обновлённый TLS-фейк из 1.10.4.',
    feats: ['fake+multisplit', 'hostfakesplit'] },
  { file: 'general (ALT13).bat', name: 'ALT13', group: 'Advanced',
    note: 'Fake TLS с sochi.park — свежий фейк релиза 1.10.4.',
    feats: ['fake+multisplit', 'fake-tls=sochi'] },
  { file: 'general (EXP).bat', name: 'EXP', group: 'Advanced',
    note: 'Экспериментальная: максимум техник одновременно. Запускать, если остальные не дали результата.',
    feats: ['fake+multisplit', 'hostfakesplit', 'exp'] },
  { file: 'general (FAKE TLS AUTO).bat', name: 'FAKE TLS AUTO', group: 'Fake',
    note: 'Автоматический подбор позиции разреза (1,midsld) без внешнего фейка.',
    feats: ['fake-tls-auto', 'midsld'] },
  { file: 'general (FAKE TLS AUTO ALT).bat', name: 'FAKE TLS AUTO ALT', group: 'Fake',
    note: 'Автоматическая позиция, 11 повторов — вариант для нестабильных каналов.',
    feats: ['fake-tls-auto', 'repeats=11'] },
  { file: 'general (FAKE TLS AUTO ALT2).bat', name: 'FAKE TLS AUTO ALT2', group: 'Fake',
    note: 'Авто-позиция + multisplit с seqovl 681.',
    feats: ['fake-tls-auto', 'multisplit'] },
  { file: 'general (FAKE TLS AUTO ALT3).bat', name: 'FAKE TLS AUTO ALT3', group: 'Fake',
    note: 'Авто-позиция + fooling=ts: обход проверки TTL у DPI.',
    feats: ['fake-tls-auto', 'fooling=ts'] },
  { file: 'general (SIMPLE FAKE).bat', name: 'SIMPLE FAKE', group: 'Fake',
    note: 'Простые фейки без разрезов. Иногда самый надёжный вариант для мобильного интернета.',
    feats: ['fake-tls', 'hostfakesplit'] },
  { file: 'general (SIMPLE FAKE ALT).bat', name: 'SIMPLE FAKE ALT', group: 'Fake',
    note: 'Простой фейк со stun2.bin в качестве TLS-бланка.',
    feats: ['fake-tls=stun2'] },
  { file: 'general (SIMPLE FAKE ALT2).bat', name: 'SIMPLE FAKE ALT2', group: 'Fake',
    note: 'Простой фейк + fooling=ts.',
    feats: ['fake-tls=stun2', 'fooling=ts'] }
];

/* Формат файла utils/game_filter.enabled, который читает service.bat */
function gameFilterModeToFlag(mode) {
  if (mode === 'tcp' || mode === 'udp' || mode === 'all') return mode;
  return 'disabled';
}

module.exports = { STRATEGIES, ZAPRET_VERSION, gameFilterModeToFlag };

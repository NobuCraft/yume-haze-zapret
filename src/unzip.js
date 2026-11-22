'use strict';
/* Минимальный ZIP-распаковщик (без внешних зависимостей):
   поддержка методов store (0) и deflate (8), UTF-8 и CP437-имён. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function findEOCD(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function decodeName(buf, flags) {
  if (flags & 0x800) return buf.toString('utf8');
  // CP437 → latin1 приближение достаточно для имён в архивах релиза
  return buf.toString('latin1');
}

function unzip(zipPath, destDir, { onProgress } = {}) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('Не найден конец ZIP-архива');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  let done = 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = decodeName(buf.subarray(off + 46, off + 46 + nameLen), flags);
    off += 46 + nameLen + extraLen + commentLen;

    if (!name || name.endsWith('/')) continue;
    const safe = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '..').join('/');
    if (!safe) continue;
    const target = path.join(destDir, safe);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('Неподдерживаемый метод сжатия: ' + method);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    out.push(safe);
    done++;
    if (onProgress) onProgress(done / count);
    if (uncompSize !== data.length) { /* размеры в архиве могут быть 0 при data descriptor */ }
  }
  return out;
}

module.exports = { unzip, findEOCD };

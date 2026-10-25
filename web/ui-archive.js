// Small, dependency-free ZIP writer for bundling locally generated downloads.
// Entries are stored verbatim. This does not implement or replace native exports.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function zipStore(files) {
  const chunks = [], directory = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const used = new Set();
  for (const file of files) {
    let name = String(file.name || 'export.bin').replaceAll('\\', '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/');
    if (!name) name = 'export.bin';
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name;
      const suffix = dot > name.lastIndexOf('/') ? name.slice(dot) : '';
      let n = 2;
      while (used.has(`${stem}-${n}${suffix}`)) n++;
      name = `${stem}-${n}${suffix}`;
    }
    used.add(name);
    const filename = encoder.encode(name);
    const raw = file.data instanceof Blob ? await file.data.arrayBuffer() : typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (data.length > 0xffffffff || offset > 0xffffffff || filename.length > 65535 || files.length > 65535) throw new Error('导出文件过大，无法打包为 ZIP。请减少批量项目。');
    const crc = crc32(data);
    const local = new Uint8Array(30 + filename.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(10, time, true); l.setUint16(12, date, true); l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, filename.length, true);
    local.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, filename.length, true); c.setUint32(42, offset, true);
    central.set(filename, 46);
    chunks.push(local, data); directory.push(central); offset += local.length + data.length;
  }
  const directorySize = directory.reduce((n, bytes) => n + bytes.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], {type: 'application/zip'});
}

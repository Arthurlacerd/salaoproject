// Gerador mínimo de ZIP (método "store", sem compressão) — sem dependências.
const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const enc = new TextEncoder();
export function criarZip(arquivos, data = new Date()) { // arquivos: [{nome, dados: Uint8Array|string}]
  const dosT = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1), dosD = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
  const partes = [], central = []; let desloc = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome), d = typeof a.dados === "string" ? enc.encode(a.dados) : a.dados, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nome.length, true); h.setUint16(28, 0, true);
    partes.push(new Uint8Array(h.buffer), nome, d);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nome.length, true); c.setUint32(42, desloc, true);
    central.push(new Uint8Array(c.buffer), nome); desloc += 30 + nome.length + d.length;
  }
  const tamC = central.reduce((s, x) => s + x.length, 0), f = new DataView(new ArrayBuffer(22)); f.setUint32(0, 0x06054b50, true); f.setUint16(8, arquivos.length, true); f.setUint16(10, arquivos.length, true); f.setUint32(12, tamC, true); f.setUint32(16, desloc, true);
  return new Blob([...partes, ...central, new Uint8Array(f.buffer)], { type: "application/zip" });
}

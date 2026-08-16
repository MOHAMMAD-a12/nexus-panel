// components/qrcode.js — self-contained QR encoder (byte mode, UTF-8, versions 1-10)
// Based on the public-domain QR Code algorithm (Kazuhiko Arase, MIT). No deps.

const PAD0 = 0xec, PAD1 = 0x11;

// error correction level format values
const EC = { L: 1, M: 0, Q: 3, H: 2 };

// RS block table, ordered per version: [L, M, Q, H]
const RS_BLOCK_TABLE = [
  // 1
  [[1, 26, 19]], [[1, 26, 16]], [[1, 26, 13]], [[1, 26, 9]],
  // 2
  [[1, 44, 34]], [[1, 44, 28]], [[1, 44, 22]], [[1, 44, 16]],
  // 3
  [[1, 70, 55]], [[1, 70, 44]], [[2, 35, 17]], [[2, 35, 13]],
  // 4
  [[1, 100, 80]], [[2, 50, 32]], [[2, 50, 24]], [[4, 25, 9]],
  // 5
  [[1, 134, 108]], [[2, 67, 43]], [[2, 33, 15], [2, 34, 16]], [[2, 33, 11], [2, 34, 12]],
  // 6
  [[2, 86, 68]], [[4, 43, 27]], [[4, 43, 19]], [[4, 43, 15]],
  // 7
  [[2, 98, 78]], [[4, 49, 31]], [[2, 32, 14], [4, 33, 15]], [[4, 39, 13], [1, 40, 14]],
  // 8
  [[2, 121, 97]], [[2, 60, 38], [2, 61, 39]], [[4, 40, 18], [2, 41, 19]], [[4, 40, 14], [2, 41, 15]],
  // 9
  [[2, 146, 116]], [[3, 58, 36], [2, 59, 37]], [[4, 36, 16], [4, 37, 17]], [[4, 36, 12], [4, 37, 13]],
  // 10
  [[2, 86, 68], [2, 87, 69]], [[4, 69, 43], [1, 70, 44]], [[6, 43, 19], [2, 44, 20]], [[6, 43, 15], [2, 44, 16]],
];

const PATTERN_POSITION_TABLE = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function getBCHTypeInfo(data) {
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
  return ((data << 10) | d) ^ G15_MASK;
}
function getBCHTypeNumber(data) {
  let d = data << 12;
  while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= G18 << (getBCHDigit(d) - getBCHDigit(G18));
  return (data << 12) | d;
}
function getBCHDigit(data) {
  let digit = 0;
  while (data !== 0) { digit++; data >>>= 1; }
  return digit;
}

const EXP_TABLE = new Array(256);
const LOG_TABLE = new Array(256);
(function () {
  let v = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = v;
    LOG_TABLE[v] = i;
    v <<= 1;
    if (v & 0x100) v ^= 0x11d;
  }
})();
function glog(n) { return LOG_TABLE[n]; }
function gexp(n) { return EXP_TABLE[n % 255]; }

class Polynomial {
  constructor(num, shift = 0) {
    this.num = [];
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    for (let i = offset; i < num.length; i++) this.num.push(num[i]);
    for (let i = 0; i < shift; i++) this.num.push(0);
  }
  getLength() { return this.num.length; }
  get(i) { return this.num[i]; }
  multiply(e) {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++)
      for (let j = 0; j < e.getLength(); j++)
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
    return new Polynomial(num);
  }
  mod(e) {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = this.num.map((v, i) => i < e.getLength() ? v ^ gexp(glog(e.get(i)) + ratio) : v);
    return new Polynomial(num).mod(e);
  }
}

function rsPoly(ecLength) {
  let poly = new Polynomial([1]);
  for (let i = 0; i < ecLength; i++) poly = poly.multiply(new Polynomial([1, gexp(i)]));
  return poly;
}

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return out;
}

const MASK_FN = [
  (i, j) => (i + j) % 2 === 0,
  (i, j) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => ((i / 2 | 0) + (j / 3 | 0)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
  (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0,
];

export function createQR(text, ecLevel = 'M') {
  const bytes = utf8Bytes(text);
  // choose smallest version 1..10 that fits
  let version = -1;
  for (let v = 1; v <= 10; v++) {
    const dataCap = dataCapacity(v, ecLevel);
    if (bytes.length <= dataCap) { version = v; break; }
  }
  if (version === -1) throw new Error('Data too long for QR (max version 10)');
  return new QRCode(version, ecLevel, bytes);
}

function dataCapacity(version, ecLevel) {
  const idx = { L: 0, M: 1, Q: 2, H: 3 }[ecLevel];
  const blocks = RS_BLOCK_TABLE[(version - 1) * 4 + idx];
  let totalData = 0;
  for (const g of blocks) totalData += g[2] * g[0];
  // byte mode overhead: 4 (mode) + 8 or 16 (length) + 4 (terminator handled later)
  const lenBits = version <= 9 ? 8 : 16;
  return totalData - Math.ceil((4 + lenBits) / 8);
}

class QRCode {
  constructor(version, ecLevel, bytes) {
    this.version = version;
    this.ecLevel = ecLevel;
    this.moduleCount = version * 4 + 17;
    this.modules = [];
    for (let r = 0; r < this.moduleCount; r++) this.modules.push(new Array(this.moduleCount).fill(null));
    this._build(bytes);
  }
  getModuleCount() { return this.moduleCount; }
  isDark(r, c) { return this.modules[r][c]; }

  _build(bytes) {
    this._setupPositionProbePattern(0, 0);
    this._setupPositionProbePattern(this.moduleCount - 7, 0);
    this._setupPositionProbePattern(0, this.moduleCount - 7);
    this._setupPositionAdjustPattern();
    this._setupTimingPattern();
    this._setupTypeInfo();
    if (this.version >= 7) this._setupTypeNumber();
    const data = this._createData(bytes);
    this._mapData(data);
  }

  _setupPositionProbePattern(row, col) {
    for (let r = -1; r <= 7; r++) {
      if (row + r < 0 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c < 0 || this.moduleCount <= col + c) continue;
        const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        this.modules[row + r][col + c] = dark;
      }
    }
  }
  _setupTimingPattern() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] === null) this.modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] === null) this.modules[6][c] = c % 2 === 0;
    }
  }
  _setupPositionAdjustPattern() {
    const pos = PATTERN_POSITION_TABLE[this.version - 1];
    for (let i = 0; i < pos.length; i++)
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i], col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++)
          for (let c = -2; c <= 2; c++)
            this.modules[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
      }
  }
  _setupTypeNumber() {
    const bits = getBCHTypeNumber(this.version);
    for (let i = 0; i < 18; i++) {
      const mod = i % 3;
      i < 6 ? (this.modules[i][8] = (bits >> i) & 1 === 1)
        : i < 12 ? (this.modules[i + 1][8] = (bits >> i) & 1 === 1)
          : (this.modules[this.moduleCount - 18 + i - 12][8] = (bits >> i) & 1 === 1);
    }
    for (let i = 0; i < 18; i++) {
      const mod = i % 3;
      i < 6 ? (this.modules[8][i] = (bits >> i) & 1 === 1)
        : i < 12 ? (this.modules[8][i + 1] = (bits >> i) & 1 === 1)
          : (this.modules[8][this.moduleCount - 18 + i - 12] = (bits >> i) & 1 === 1);
    }
  }
  _setupTypeInfo() {
    const data = (EC[this.ecLevel] << 3) | this._maskPattern;
    const bits = getBCHTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      const mod = (bits >> i) & 1 === 1;
      if (i < 6) this.modules[i][8] = mod;
      else if (i < 8) this.modules[i + 1][8] = mod;
      else this.modules[this.moduleCount - 15 + i][8] = mod;
    }
    for (let i = 0; i < 15; i++) {
      const mod = (bits >> i) & 1 === 1;
      if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
      else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
      else this.modules[8][15 - i - 1] = mod;
    }
    this.modules[this.moduleCount - 8][8] = true; // dark module
  }

  _createData(bytes) {
    const rsBlocks = this._rsBlocks();
    const buffer = [];
    const lenBits = this.version <= 9 ? 8 : 16;
    // mode 0100 (byte)
    buffer.push(0, 0, 0, 1); // 4 bits
    // length
    for (let i = lenBits - 1; i >= 0; i--) buffer.push((bytes.length >> i) & 1);
    // data
    for (const b of bytes) {
      for (let i = 7; i >= 0; i--) buffer.push((b >> i) & 1);
    }
    let totalDataCount = 0;
    for (const g of rsBlocks) totalDataCount += g.dataCount * g.count;
    // terminator
    const cap = totalDataCount * 8;
    if (buffer.length + 4 <= cap) buffer.push(1, 0, 0, 0);
    while (buffer.length % 8 !== 0) buffer.push(0);
    // padding
    while (true) {
      if (buffer.length >= cap) break;
      buffer.push((PAD0 >> 4) & 1, (PAD0 >> 3) & 1, (PAD0 >> 2) & 1, (PAD0 >> 1) & 1, PAD0 & 1);
      if (buffer.length >= cap) break;
      buffer.push((PAD1 >> 4) & 1, (PAD1 >> 3) & 1, (PAD1 >> 2) & 1, (PAD1 >> 1) & 1, PAD1 & 1);
    }
    // interleave
    return this._createBytes(buffer, rsBlocks);
  }

  _rsBlocks() {
    const idx = { L: 0, M: 1, Q: 2, H: 3 }[this.ecLevel];
    const table = RS_BLOCK_TABLE[(this.version - 1) * 4 + idx];
    const blocks = [];
    for (const g of table) {
      const [count, totalCount, dataCount] = g;
      for (let i = 0; i < count; i++) blocks.push({ totalCount, dataCount });
    }
    return blocks;
  }

  _createBytes(buffer, rsBlocks) {
    let offset = 0;
    const maxDc = Math.max(...rsBlocks.map(b => b.dataCount));
    const maxEc = Math.max(...rsBlocks.map(b => b.totalCount - b.dataCount));
    const dcdata = [], ecdata = [];
    for (const b of rsBlocks) {
      const dc = buffer.slice(offset, offset + b.dataCount * 8).reduce((acc, bit, i) => i % 8 === 0 ? acc : (acc << 1) | bit, 0);
      // better: collect bytes
      const bytes = [];
      for (let i = 0; i < b.dataCount * 8; i += 8) {
        let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | buffer[offset + i + k];
        bytes.push(v);
      }
      offset += b.dataCount * 8;
      const rsPolyE = rsPoly(b.totalCount - b.dataCount);
      const rawPoly = new Polynomial(bytes);
      const modPoly = rawPoly.mod(rsPolyE);
      const ec = new Array(b.totalCount - b.dataCount).fill(0);
      for (let i = 0; i < modPoly.getLength(); i++) ec[i] = modPoly.get(i);
      dcdata.push(bytes);
      ecdata.push(ec);
    }
    let totalCodeCount = rsBlocks.reduce((a, b) => a + b.totalCount, 0);
    const out = [];
    for (let i = 0; i < maxDc; i++)
      for (let k = 0; k < dcdata.length; k++)
        if (i < dcdata[k].length) out.push(dcdata[k][i]);
    for (let i = 0; i < maxEc; i++)
      for (let k = 0; k < ecdata.length; k++)
        if (i < ecdata[k].length) out.push(ecdata[k][i]);
    return out;
  }

  _mapData(data) {
    let inc = -1, row = this.moduleCount - 1, bitIdx = 0;
    // choose best mask (lost-point scoring would be ideal; use mask 0 for simplicity + spec-compliant)
    this._maskPattern = 0;
    let col = this.moduleCount - 1;
    while (col > 0) {
      if (col === 6) col--;
      for (let i = 0; i < this.moduleCount; i++) {
        const r = inc < 0 ? i : this.moduleCount - 1 - i;
        for (let c = 0; c < 2; c++) {
          if (this.modules[r][col - c] === null) {
            let dark = false;
            if (bitIdx < data.length * 8) {
              dark = ((data[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
              bitIdx++;
            }
            if (MASK_FN[0](r, col - c)) dark = !dark;
            this.modules[r][col - c] = dark;
          }
        }
      }
      col -= 2;
      inc = -inc;
    }
  }
}

// Render to a DOM canvas-friendly data structure / SVG string
export function qrSvg(text, { ecLevel = 'M', size = 200, margin = 2 } = {}) {
  const qr = createQR(text, ecLevel);
  const count = qr.getModuleCount();
  const dim = count + margin * 2;
  const scale = size / dim;
  let cells = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        const x = (c + margin) * scale, y = (r + margin) * scale;
        cells += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${scale.toFixed(2)}" height="${scale.toFixed(2)}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${dim * scale} ${dim * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${cells}</g></svg>`;
}

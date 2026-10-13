import React from "react";

// GF(256) tables with primitive polynomial 0x11D
const GF_EXP: number[] = new Array(512);
const GF_LOG: number[] = new Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenPoly(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGenPoly(ecCount);
  const res = [...data, ...new Array(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const lead = res[i];
    if (lead !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(lead, gen[j]);
      }
    }
  }
  return res.slice(data.length);
}

// Table of QR versions (Version 1 to 6, Error Correction Level L)
interface VersionInfo {
  ver: number;
  size: number;
  dataCap: number;
  ecCap: number;
  alignCenter: number | null;
}

const VERSIONS: VersionInfo[] = [
  { ver: 1, size: 21, dataCap: 19, ecCap: 7, alignCenter: null },
  { ver: 2, size: 25, dataCap: 34, ecCap: 10, alignCenter: 18 },
  { ver: 3, size: 29, dataCap: 55, ecCap: 15, alignCenter: 22 },
  { ver: 4, size: 33, dataCap: 80, ecCap: 20, alignCenter: 26 },
  { ver: 5, size: 37, dataCap: 108, ecCap: 26, alignCenter: 30 },
  { ver: 6, size: 41, dataCap: 136, ecCap: 28, alignCenter: 34 },
];

export function generateQrMatrix(text: string): boolean[][] | null {
  try {
    const raw = new TextEncoder().encode(text);
    let chosen: VersionInfo | null = null;
    for (const v of VERSIONS) {
      if (raw.length + 3 <= v.dataCap) {
        chosen = v;
        break;
      }
    }
    if (!chosen) chosen = VERSIONS[VERSIONS.length - 1];

    const { size, dataCap, ecCap, alignCenter } = chosen;

    // Bitstream: 0100 (Byte mode) + 8-bit length + data
    const bits: number[] = [];
    const pushBits = (val: number, len: number) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    pushBits(0b0100, 4); // Byte mode
    pushBits(raw.length, 8); // Length
    for (const byte of raw) pushBits(byte, 8);
    // Terminator (up to 4 zeroes)
    const termLen = Math.min(4, dataCap * 8 - bits.length);
    pushBits(0, termLen);
    // Align to byte
    while (bits.length % 8 !== 0) bits.push(0);

    // Convert to bytes
    const dataBytes: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataBytes.push(b);
    }

    // Pad bytes alternating 0xEC and 0x11
    let padToggle = false;
    while (dataBytes.length < dataCap) {
      dataBytes.push(padToggle ? 0x11 : 0xec);
      padToggle = !padToggle;
    }

    const ecBytes = rsEncode(dataBytes, ecCap);
    const allCodewords = [...dataBytes, ...ecBytes];

    // Construct matrix
    const matrix: (number | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null));

    // Place finder patterns
    const placeFinder = (r0: number, c0: number) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const row = r0 + r;
          const col = c0 + c;
          if (row < 0 || row >= size || col < 0 || col >= size) continue;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
            const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            matrix[row][col] = isBorder || isCenter ? 1 : 0;
          } else {
            matrix[row][col] = 0; // Separator
          }
        }
      }
    };

    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0 ? 1 : 0;
      if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0 ? 1 : 0;
    }

    // Alignment pattern
    if (alignCenter !== null) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const row = alignCenter + r;
          const col = alignCenter + c;
          if (matrix[row][col] === null) {
            const isEdge = Math.abs(r) === 2 || Math.abs(c) === 2;
            const isDot = r === 0 && c === 0;
            matrix[row][col] = isEdge || isDot ? 1 : 0;
          }
        }
      }
    }

    // Dark module
    matrix[4 * chosen.ver + 9][8] = 1;

    // Reserve format information areas
    for (let i = 0; i < 9; i++) {
      if (matrix[8][i] === null) matrix[8][i] = -1;
      if (matrix[i][8] === null) matrix[i][8] = -1;
    }
    for (let i = size - 8; i < size; i++) {
      if (matrix[8][i] === null) matrix[8][i] = -1;
      if (matrix[i][8] === null) matrix[i][8] = -1;
    }

    // Place data bits in zig-zag
    const allBits: number[] = [];
    for (const b of allCodewords) {
      for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1);
    }

    let bitIdx = 0;
    let upwards = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right--; // Skip vertical timing column
      const left = right - 1;
      const rows = upwards
        ? Array.from({ length: size }, (_, i) => size - 1 - i)
        : Array.from({ length: size }, (_, i) => i);

      for (const row of rows) {
        for (const col of [right, left]) {
          if (matrix[row][col] === null) {
            const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
            // Mask 0: (row + col) % 2 === 0
            const mask = (row + col) % 2 === 0 ? 1 : 0;
            matrix[row][col] = bit ^ mask;
          }
        }
      }
      upwards = !upwards;
    }

    // Format information bits for Level L, Mask 0: 0x77c4 (15 bits)
    const fmt = 0x77c4;
    const getFmtBit = (idx: number) => (fmt >> (14 - idx)) & 1;

    // Place around top-left
    matrix[8][0] = getFmtBit(0);
    matrix[8][1] = getFmtBit(1);
    matrix[8][2] = getFmtBit(2);
    matrix[8][3] = getFmtBit(3);
    matrix[8][4] = getFmtBit(4);
    matrix[8][5] = getFmtBit(5);
    matrix[8][7] = getFmtBit(6);
    matrix[8][8] = getFmtBit(7);
    matrix[7][8] = getFmtBit(8);
    matrix[5][8] = getFmtBit(9);
    matrix[4][8] = getFmtBit(10);
    matrix[3][8] = getFmtBit(11);
    matrix[2][8] = getFmtBit(12);
    matrix[1][8] = getFmtBit(13);
    matrix[0][8] = getFmtBit(14);

    // Place around corners
    for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = getFmtBit(i);
    for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = getFmtBit(7 + i);

    return matrix.map((row) => row.map((cell) => cell === 1));
  } catch {
    return null;
  }
}

interface Props {
  value: string;
  size?: number;
  className?: string;
}

export const QrCodeSvg: React.FC<Props> = ({ value, size = 150, className = "" }) => {
  const matrix = React.useMemo(() => generateQrMatrix(value), [value]);

  if (!matrix) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`bg-white/10 rounded-xl flex flex-col items-center justify-center p-2 text-center text-[10px] text-gray-300 ${className}`}
      >
        <span>📱 اسکن دانلود</span>
        <span className="font-mono text-[9px] text-cyan-300 truncate max-w-full px-1">{value}</span>
      </div>
    );
  }

  const dim = matrix.length;
  const padding = 2;
  const total = dim + padding * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className={`rounded-xl bg-white p-2 shadow-md ${className}`}
      aria-label="کد QR جهت اسکن و دانلود موبایل"
    >
      <rect width={total} height={total} fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((active, c) =>
          active ? (
            <rect
              key={`${r}-${c}`}
              x={c + padding}
              y={r + padding}
              width={1}
              height={1}
              fill="#0d1117"
            />
          ) : null
        )
      )}
    </svg>
  );
};

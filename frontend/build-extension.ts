import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, deflateSync } from "node:zlib";

const CRC_TABLE = buildCrcTable();

const compiledDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.basename(compiledDir) === "dist"
  ? path.resolve(compiledDir, "..")
  : compiledDir;
const rootDir = path.resolve(frontendDir, "..");
const extensionDir = path.join(rootDir, "extension");
const iconDir = path.join(extensionDir, "icons");
const packagePath = path.join(frontendDir, "curion-extension.zip");
const brandMarkPath = path.join(frontendDir, "curion-mark.png");

fs.mkdirSync(iconDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const iconPath = path.join(iconDir, `icon${size}.png`);
  fs.writeFileSync(iconPath, renderIcon(size));
}

fs.copyFileSync(path.join(iconDir, "icon128.png"), brandMarkPath);
fs.writeFileSync(packagePath, createZipArchive(extensionDir));

console.log(`Built ${path.relative(rootDir, packagePath)}`);
console.log(`Built ${path.relative(rootDir, brandMarkPath)}`);

function renderIcon(size) {
  const bg = 7;
  const supersample = 4;
  const width = size;
  const height = size;
  const pixels = Buffer.alloc(width * height * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * 0.325;
  const stroke = Math.max(size * 0.14, 2);
  const inner = radius - stroke / 2;
  const outer = radius + stroke / 2;
  const gap = Math.PI / 5.4;
  const capRadius = stroke / 2;
  const startCap = {
    x: cx + radius * Math.cos(gap),
    y: cy + radius * Math.sin(gap)
  };
  const endCap = {
    x: cx + radius * Math.cos(Math.PI * 2 - gap),
    y: cy + radius * Math.sin(Math.PI * 2 - gap)
  };
  const capRadiusSquared = capRadius * capRadius;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let coverage = 0;

      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const sampleX = x + (sx + 0.5) / supersample;
          const sampleY = y + (sy + 0.5) / supersample;
          if (isWhite(sampleX, sampleY)) {
            coverage += 1;
          }
        }
      }

      coverage /= supersample * supersample;
      const value = Math.round(bg + coverage * (255 - bg));
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }

  return encodePng(width, height, pixels);

  function isWhite(px, py) {
    const dx = px - cx;
    const dy = py - cy;
    const distance = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx));
    const inRing = distance >= inner && distance <= outer;
    const inGap = angle <= gap || angle >= Math.PI * 2 - gap;

    if (inRing && !inGap) {
      return true;
    }

    return (
      squaredDistance(px, py, startCap.x, startCap.y) <= capRadiusSquared ||
      squaredDistance(px, py, endCap.x, endCap.y) <= capRadiusSquared
    );
  }
}

function normalizeAngle(angle) {
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function squaredDistance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function encodePng(width, height, rgbaPixels) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * width * 4;
    const dstOffset = y * rowLength;
    raw[dstOffset] = 0;
    rgbaPixels.copy(raw, dstOffset + 1, srcOffset, srcOffset + width * 4);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    createChunk("IHDR", createIhdr(width, height)),
    createChunk("IDAT", deflateSync(raw)),
    createChunk("IEND", Buffer.alloc(0))
  ];

  return Buffer.concat([signature, ...chunks]);
}

function createIhdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(baseDir) {
  const entries = collectFiles(baseDir)
    .filter((entry) => !entry.relativePath.startsWith("curion-extension.zip"))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const fileName = Buffer.from(entry.relativePath.replace(/\\/g, "/"), "utf8");
    const modTimeDate = toDosDateTime(entry.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(modTimeDate.time, 10);
    localHeader.writeUInt16LE(modTimeDate.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileName, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(modTimeDate.time, 12);
    centralHeader.writeUInt16LE(modTimeDate.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(((entry.isExecutable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function collectFiles(baseDir) {
  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, absolutePath);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = fs.statSync(absolutePath);
      results.push({
        relativePath,
        data: fs.readFileSync(absolutePath),
        mtime: stat.mtime,
        isExecutable: (stat.mode & 0o111) !== 0
      });
    }
  }

  walk(baseDir);
  return results;
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time: dosTime, date: dosDate };
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

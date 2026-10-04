#!/usr/bin/env node
/**
 * NEON FRONT 2.0 — CC0 varlık indirici
 * ---------------------------------------------------------------
 * Bağımlılık YOK. Node 18+ gerekir (global fetch + node:zlib).
 * ZIP dosyalarını kendi içinde açar (inflateRaw), harici araç kullanmaz.
 *
 * Kaynaklar (hepsi CC0 / kamu malı, ticari kullanım serbest):
 *   - ambientCG  https://ambientcg.com    (doku)
 *   - Poly Haven https://polyhaven.com    (doku)
 *
 * Kullanım:
 *   node tools/fetch-assets.mjs
 *   node tools/fetch-assets.mjs --force     (var olanları yeniden indir)
 *   node tools/fetch-assets.mjs --only=grass,rock
 */
import { mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX_DIR = join(ROOT, 'assets', 'textures');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;

/* ---------------------------------------------------------------
   İndirilecek malzemeler (ambientCG asset kimlikleri)
   İsimler oyun içinde kullanılan anahtarlardır.
   --------------------------------------------------------------- */
const MATERIALS = [
  { name: 'grass',    id: 'Grass001' },
  { name: 'grass_alt', id: 'Grass004' },
  { name: 'dirt',     id: 'Ground037' },
  { name: 'sand',     id: 'Ground033' },
  { name: 'sand_alt', id: 'Ground054' },
  { name: 'rock',     id: 'Rock023' },
  { name: 'rock_alt', id: 'Rock030' },
  { name: 'wood',     id: 'Wood051' },
  { name: 'metal',    id: 'Metal032' },
  { name: 'gravel',   id: 'Gravel023' },
  { name: 'concrete', id: 'Concrete034' }
];

/* ---------------------------------------------------------------
   İndirilecek model paketleri (Kenney — CC0, .glb içerir)
   Sayfa JS ile render edildiği için zip bağlantısı HTML'den çıkarılır.
   --------------------------------------------------------------- */
const MODEL_PACKS = [
  { name: 'nature-kit',        page: 'https://kenney.nl/assets/nature-kit' },
  { name: 'tower-defense-kit', page: 'https://kenney.nl/assets/tower-defense-kit' },
  { name: 'city-kit-industrial', page: 'https://kenney.nl/assets/city-kit-industrial' },
  { name: 'car-kit',           page: 'https://kenney.nl/assets/car-kit' }
];

/* ZIP içinden alınacak harita türleri */
const MAP_KINDS = ['Color', 'NormalGL', 'Roughness', 'AmbientOcclusion', 'Metalness', 'Displacement'];
const MAP_OUT = {
  Color: 'color',
  NormalGL: 'normal',
  Roughness: 'roughness',
  AmbientOcclusion: 'ao',
  Metalness: 'metalness',
  Displacement: 'displacement'
};

/* ---------------------------------------------------------------
   Minimal ZIP okuyucu (bağımlılıksız)
   --------------------------------------------------------------- */
function listZipEntries(buf) {
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: EOCD bulunamadi');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractZipEntry(buf, entry) {
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('ZIP: yerel baslik bozuk');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error('ZIP: desteklenmeyen sikistirma ' + entry.method);
}

/* ---------------------------------------------------------------
   Yardımcılar
   --------------------------------------------------------------- */
async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function fmtKB(n) { return (n / 1024).toFixed(0) + ' KB'; }

/* ---------------------------------------------------------------
   Ana akış
   --------------------------------------------------------------- */
async function fetchMaterial(mat) {
  const zipUrl = `https://ambientcg.com/get?file=${mat.id}_1K-JPG.zip`;
  let buf;
  try {
    buf = await download(zipUrl);
  } catch (e) {
    console.log(`  [ATLA] ${mat.name} (${mat.id}) — indirilemedi: ${e.message}`);
    return [];
  }

  let entries;
  try {
    entries = listZipEntries(buf);
  } catch (e) {
    console.log(`  [HATA] ${mat.name} — ${e.message}`);
    return [];
  }

  const written = [];
  for (const kind of MAP_KINDS) {
    const entry = entries.find((en) =>
      new RegExp(`_${kind}\\.(jpg|jpeg|png)$`, 'i').test(en.name) && !en.name.includes('/')
    );
    if (!entry) continue;
    const outName = `${mat.name}_${MAP_OUT[kind]}.jpg`;
    const outPath = join(TEX_DIR, outName);
    if (!FORCE && await exists(outPath)) { written.push(outName); continue; }
    try {
      const data = extractZipEntry(buf, entry);
      await writeFile(outPath, data);
      written.push(outName);
    } catch (e) {
      console.log(`  [HATA] ${mat.name}/${kind} — ${e.message}`);
    }
  }
  console.log(`  [OK] ${mat.name.padEnd(10)} ${mat.id.padEnd(12)} zip=${fmtKB(buf.length)}  maps=${written.length}`);
  return written;
}

/* ---------------------------------------------------------------
   Model indirme (Kenney CC0 .glb paketleri)
   --------------------------------------------------------------- */
async function resolvePackZipUrl(page) {
  const res = await fetch(page, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const m = html.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"'\s\\]+\.zip/);
  if (!m) throw new Error('zip baglantisi bulunamadi');
  return m[0];
}

async function fetchModelPack(pack) {
  const dir = join(ROOT, 'assets', 'models', pack.name);
  await mkdir(dir, { recursive: true });
  if (!FORCE && await exists(join(dir, '.done'))) {
    console.log(`  [OK] ${pack.name.padEnd(18)} (zaten indirilmis)`);
    return 0;
  }
  let zipUrl;
  try { zipUrl = await resolvePackZipUrl(pack.page); }
  catch (e) { console.log(`  [ATLA] ${pack.name} — ${e.message}`); return 0; }

  let buf;
  try { buf = await download(zipUrl); }
  catch (e) { console.log(`  [ATLA] ${pack.name} — indirilemedi: ${e.message}`); return 0; }

  let entries;
  try { entries = listZipEntries(buf); }
  catch (e) { console.log(`  [HATA] ${pack.name} — ${e.message}`); return 0; }

  let n = 0;
  for (const en of entries) {
    if (!/\.glb$/i.test(en.name)) continue;
    const base = en.name.split('/').pop();
    const outPath = join(dir, base);
    if (!FORCE && await exists(outPath)) { n++; continue; }
    try {
      await writeFile(outPath, extractZipEntry(buf, en));
      n++;
    } catch (e) {
      console.log(`  [HATA] ${pack.name}/${base} — ${e.message}`);
    }
  }
  if (n > 0) await writeFile(join(dir, '.done'), new Date().toISOString(), 'utf8');
  console.log(`  [OK] ${pack.name.padEnd(18)} zip=${fmtKB(buf.length)}  glb=${n}`);
  return n;
}

async function writeCredits() {
  const texCount = (await readdir(TEX_DIR).catch(() => []))
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).length;
  const lines = [
    '# Varlık Kaynakları ve Lisanslar',
    '',
    'Bu projedeki tüm harici varlıklar **CC0 1.0 (Kamu Malı)** lisanslıdır.',
    'Ticari kullanım, değiştirme ve yeniden dağıtım serbesttir; atıf zorunlu değildir.',
    '',
    '## Dokular — ambientCG (https://ambientcg.com)',
    '',
    '| Dosya öneki | Asset ID | Lisans |',
    '|---|---|---|'
  ];
  for (const m of MATERIALS) {
    lines.push(`| \`${m.name}_*\` | ${m.id} | CC0 1.0 |`);
  }
  lines.push('');
  lines.push('## 3D Modeller — Kenney (https://kenney.nl)');
  lines.push('');
  lines.push('| Paket klasörü | İçerik | Lisans |');
  lines.push('|---|---|---|');
  const packDesc = {
    'nature-kit': 'ağaç, kaya, çalı, köprü, çit modülleri',
    'tower-defense-kit': 'kule, bina, detay, dekor parçaları',
    'city-kit-industrial': 'fabrika, depo, sanayi binaları',
    'car-kit': 'araç gövdeleri, tekerlekler, yollar'
  };
  for (const p of MODEL_PACKS) {
    lines.push(`| \`assets/models/${p.name}\` | ${packDesc[p.name] || '3D modeller'} | CC0 1.0 |`);
  }
  lines.push('');
  lines.push('> Tüm varlıklar CC0 1.0 (Kamu Malı) — atıf zorunlu değildir.');
  lines.push('');
  lines.push(`Toplam indirilen doku dosyası: ${texCount}`);
  lines.push('');
  lines.push('> Bu dosya `tools/fetch-assets.mjs` tarafından otomatik üretilir.');
  await writeFile(join(ROOT, 'assets', 'CREDITS.md'), lines.join('\n'), 'utf8');
}

async function main() {
  const modelsOnly = argv.includes('--models');
  const texturesOnly = argv.includes('--textures');
  const runTextures = !modelsOnly;
  const runModels = modelsOnly || !texturesOnly;

  console.log('NEON FRONT 2.0 — CC0 varlık indirici');
  console.log('Kaynak klasörü: ' + TEX_DIR);
  await mkdir(TEX_DIR, { recursive: true });
  await mkdir(join(ROOT, 'assets', 'models'), { recursive: true });

  const all = [];
  if (runTextures) {
    const list = ONLY ? MATERIALS.filter((m) => ONLY.includes(m.name)) : MATERIALS;
    console.log(`\n[DOKULAR] İndirilecek malzeme: ${list.length}`);
    for (const mat of list) all.push(...await fetchMaterial(mat));
  }

  let modelCount = 0;
  if (runModels) {
    console.log(`\n[MODELLER] Kenney CC0 paketleri: ${MODEL_PACKS.length}`);
    for (const pack of MODEL_PACKS) modelCount += await fetchModelPack(pack);
  }

  await writeCredits();

  console.log('');
  console.log(`TOPLAM: ${all.length} doku, ${modelCount} model dosyası hazır.`);
  console.log('Lisans kaydı: assets/CREDITS.md');
}

main().catch((e) => {
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});

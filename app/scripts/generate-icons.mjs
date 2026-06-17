import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '../../Image/Tripreport image.png');
const publicDir = join(__dirname, '../public');

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon.png', size: 32 },
  { file: 'splash-logo.png', size: 256 },
];

for (const { file, size } of targets) {
  const out = join(publicDir, file);
  await sharp(src).resize(size, size, { fit: 'cover' }).png().toFile(out);
  console.log('wrote', file);
}

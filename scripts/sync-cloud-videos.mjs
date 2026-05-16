import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { list, put } from '@vercel/blob';

const root = process.cwd();
const videosDir = process.env.ODESSA_VIDEO_DIR || path.join(root, 'assets', 'videos');
const token = process.env.BLOB_READ_WRITE_TOKEN;
const dryRun = process.argv.includes('--dry-run');

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} nao configurado. Crie o Blob na Vercel e traga a variavel para o ambiente local.`);
  }
}

async function localVideos() {
  const entries = await readdir(videosDir, { withFileTypes: true });
  const videos = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(mp4|webm|mov|m4v)$/i.test(entry.name)) continue;
    const filePath = path.join(videosDir, entry.name);
    const info = await stat(filePath);
    videos.push({
      filePath,
      name: entry.name,
      blobPath: `videos/${entry.name}`,
      size: info.size,
    });
  }
  return videos;
}

async function existingBlobPaths() {
  const paths = new Set();
  let cursor;
  do {
    const page = await list({ prefix: 'videos/', cursor, token });
    for (const blob of page.blobs) paths.add(blob.pathname);
    cursor = page.cursor;
  } while (cursor);
  return paths;
}

async function main() {
  const videos = await localVideos();
  const totalMb = videos.reduce((sum, video) => sum + video.size, 0) / 1024 / 1024;
  console.log(`[odessa-cloud] ${videos.length} video(s) locais encontrados em ${videosDir} (${totalMb.toFixed(1)} MB).`);

  if (dryRun) {
    for (const video of videos) {
      console.log(`[odessa-cloud] Dry-run: enviaria ${video.name} -> ${video.blobPath}`);
    }
    return;
  }

  requireEnv('BLOB_READ_WRITE_TOKEN', token);
  const existing = await existingBlobPaths();
  let uploaded = 0;
  let skipped = 0;
  for (const video of videos) {
    if (existing.has(video.blobPath)) {
      skipped += 1;
      console.log(`[odessa-cloud] Ja existe, pulando: ${video.blobPath}`);
      continue;
    }
    const result = await put(video.blobPath, createReadStream(video.filePath), {
      access: 'public',
      token,
      addRandomSuffix: false,
    });
    uploaded += 1;
    console.log(`[odessa-cloud] Enviado: ${video.name} -> ${result.url}`);
  }
  console.log(`[odessa-cloud] Concluido. Enviados: ${uploaded}. Pulados: ${skipped}.`);
}

main().catch((error) => {
  console.error('[odessa-cloud] Erro:', error.message);
  process.exitCode = 1;
});

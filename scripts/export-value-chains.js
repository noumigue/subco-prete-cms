#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadLocalEnv } = require('./strapi-env');

const projectRoot = path.resolve(__dirname, '..');
loadLocalEnv(projectRoot);

function parseArgs(argv) {
  const options = {
    outDir: path.join(projectRoot, 'exports', 'value-chains'),
    slugs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir' && argv[index + 1]) {
      options.outDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--slug' && argv[index + 1]) {
      options.slugs.push(argv[index + 1]);
      index += 1;
      continue;
    }
  }

  if (process.env.VALUE_CHAIN_SLUGS) {
    options.slugs.push(
      ...process.env.VALUE_CHAIN_SLUGS.split(',').map((value) => value.trim()).filter(Boolean),
    );
  }

  options.slugs = [...new Set(options.slugs)];
  return options;
}

function getDatabaseConfig() {
  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DATABASE_HOST || '127.0.0.1',
        port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME || 'strapi',
        user: process.env.DATABASE_USERNAME || 'strapi',
        password: process.env.DATABASE_PASSWORD || 'strapi',
      };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveSourceFile(mediaUrl) {
  if (!mediaUrl) return null;
  const filename = path.basename(mediaUrl);
  const filePath = path.join(projectRoot, 'public', 'uploads', filename);
  return fs.existsSync(filePath) ? filePath : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(options.outDir);
  const assetsDir = path.join(options.outDir, 'assets');
  ensureDir(assetsDir);

  const client = new Client(getDatabaseConfig());
  await client.connect();

  const filters = [];
  const params = [];
  if (options.slugs.length) {
    params.push(options.slugs);
    filters.push(`slug = ANY($${params.length})`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const query = `
    WITH selected AS (
      SELECT DISTINCT ON (document_id)
        id,
        document_id,
        name,
        slug,
        short_intro,
        full_content,
        priority_order,
        is_featured_home,
        created_at,
        updated_at,
        published_at,
        locale,
        photo_hint
      FROM value_chains
      ${whereClause}
      ORDER BY document_id, (published_at IS NOT NULL) DESC, updated_at DESC, id DESC
    )
    SELECT
      vc.*,
      f.document_id AS hero_document_id,
      f.name AS hero_name,
      f.alternative_text AS hero_alternative_text,
      f.caption AS hero_caption,
      f.hash AS hero_hash,
      f.ext AS hero_ext,
      f.mime AS hero_mime,
      f.size AS hero_size,
      f.url AS hero_url,
      f.formats AS hero_formats,
      f.provider AS hero_provider
    FROM selected vc
    LEFT JOIN files_related_mph frm
      ON frm.related_id = vc.id
      AND frm.related_type = 'api::value-chain.value-chain'
      AND frm.field = 'heroImage'
    LEFT JOIN files f
      ON f.id = frm.file_id
    ORDER BY vc.priority_order ASC, vc.slug ASC
  `;

  const result = await client.query(query, params);
  await client.end();

  const exportedAt = new Date().toISOString();
  const manifest = {
    exportedAt,
    count: result.rows.length,
    items: [],
  };

  for (const row of result.rows) {
    let heroImage = null;

    if (row.hero_url) {
      const sourcePath = resolveSourceFile(row.hero_url);
      const targetFilename = path.basename(row.hero_url);
      if (!sourcePath) {
        throw new Error(`Fichier média introuvable pour ${row.slug}: ${row.hero_url}`);
      }

      const targetPath = path.join(assetsDir, targetFilename);
      fs.copyFileSync(sourcePath, targetPath);

      heroImage = {
        name: row.hero_name,
        alternativeText: row.hero_alternative_text,
        caption: row.hero_caption,
        hash: row.hero_hash,
        ext: row.hero_ext,
        mime: row.hero_mime,
        size: row.hero_size,
        url: row.hero_url,
        provider: row.hero_provider,
        formats: row.hero_formats,
        exportFile: path.join('assets', targetFilename),
      };
    }

    manifest.items.push({
      documentId: row.document_id,
      name: row.name,
      slug: row.slug,
      shortIntro: row.short_intro,
      fullContent: row.full_content,
      priorityOrder: row.priority_order,
      isFeaturedHome: row.is_featured_home,
      photoHint: row.photo_hint,
      locale: row.locale,
      published: Boolean(row.published_at),
      heroImage,
    });
  }

  const manifestPath = path.join(options.outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Export value chains créé: ${manifestPath}`);
  console.log(`Entrées exportées: ${manifest.items.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

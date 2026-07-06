#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadLocalEnv } = require('./strapi-env');

const cmsRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(cmsRoot, '..');
loadLocalEnv(cmsRoot);

const VALUE_CHAIN_FILES = [
  { slug: 'fruits-tropicaux', file: '01-fruits-tropicaux.md' },
  { slug: 'lait', file: '02-lait.md' },
  { slug: 'volaille', file: '03-volaille.md' },
  { slug: 'pisciculture-aquaculture', file: '04-pisciculture-aquaculture.md' },
  { slug: 'mines', file: '05-mines.md' },
  { slug: 'projet-transversal', file: '06-projet-transversal.md' },
];

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

function textNode(text, extra = {}) {
  return { type: 'text', text, ...extra };
}

function headingBlock(level, text) {
  return {
    type: 'heading',
    level,
    children: [textNode(text)],
  };
}

function paragraphBlock(text) {
  return {
    type: 'paragraph',
    children: [textNode(text)],
  };
}

function labeledParagraphBlock(label, value) {
  return {
    type: 'paragraph',
    children: [
      textNode(`${label} :`, { underline: true }),
      textNode(` ${value}`),
    ],
  };
}

function listBlock(items) {
  return {
    type: 'list',
    format: 'unordered',
    children: items.map((item) => ({
      type: 'list-item',
      children: [textNode(item)],
    })),
  };
}

function parseMarkdownValueChain(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const blocks = [];
  let photoHint = null;
  let currentListItems = [];

  function flushList() {
    if (!currentListItems.length) return;
    blocks.push(listBlock(currentListItems));
    currentListItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    if (line.startsWith('# ')) {
      flushList();
      continue;
    }

    if (line.startsWith('Texte court homepage :')) {
      flushList();
      continue;
    }

    if (line.startsWith('Photo principale suggérée :')) {
      flushList();
      photoHint = line.slice('Photo principale suggérée :'.length).trim();
      continue;
    }

    if (line === '## Positionnement pour la plateforme') {
      flushList();
      continue;
    }

    if (line.startsWith('## ')) {
      flushList();
      blocks.push(headingBlock(2, line.slice(3).trim()));
      continue;
    }

    if (line.startsWith('### ')) {
      flushList();
      blocks.push(headingBlock(3, line.slice(4).trim()));
      continue;
    }

    if (line.startsWith('- ')) {
      currentListItems.push(line.slice(2).trim());
      continue;
    }

    flushList();

    const labeledMatch = line.match(/^([^:]{2,80})\s:\s(.+)$/u);
    if (labeledMatch) {
      const [, label, value] = labeledMatch;
      blocks.push(labeledParagraphBlock(label.trim(), value.trim()));
      continue;
    }

    blocks.push(paragraphBlock(line));
  }

  flushList();
  return { photoHint, fullContent: blocks };
}

async function updateValueChain(client, slug, data) {
  const result = await client.query(
    `
      UPDATE value_chains
      SET
        full_content = $1::jsonb,
        photo_hint = COALESCE($2, photo_hint),
        updated_at = NOW()
      WHERE slug = $3
      RETURNING id
    `,
    [JSON.stringify(data.fullContent), data.photoHint, slug],
  );

  return result.rowCount;
}

async function main() {
  const client = new Client(getDatabaseConfig());
  await client.connect();

  const contentRoot = path.join(workspaceRoot, 'contenu', 'chaines-valeur');
  const updates = [];

  for (const entry of VALUE_CHAIN_FILES) {
    const filePath = path.join(contentRoot, entry.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier introuvable: ${filePath}`);
    }

    const parsed = parseMarkdownValueChain(filePath);
    const updatedRows = await updateValueChain(client, entry.slug, parsed);

    if (!updatedRows) {
      throw new Error(`Aucune entrée Strapi trouvée pour le slug "${entry.slug}"`);
    }

    updates.push({
      slug: entry.slug,
      rows: updatedRows,
      blocks: parsed.fullContent.length,
    });
  }

  await client.end();

  for (const update of updates) {
    console.log(`Mise à jour ${update.slug}: ${update.rows} ligne(s), ${update.blocks} bloc(s).`);
  }
}

module.exports = {
  parseMarkdownValueChain,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

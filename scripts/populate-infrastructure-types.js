#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadLocalEnv } = require('./strapi-env');

const cmsRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(cmsRoot, '..');
loadLocalEnv(cmsRoot);

const INFRA_TYPES = [
  {
    order: 1,
    slug: 'production-et-transformation',
    title: 'Production et transformation',
    nature: 'physique',
    icon: 'production',
    highlight: false,
    cardText: 'Unités de production, transformation agroalimentaire ou minière, ateliers mutualisés.',
    file: '01-production-et-transformation-2.html',
  },
  {
    order: 2,
    slug: 'stockage-et-conservation',
    title: 'Stockage et conservation',
    nature: 'physique',
    icon: 'stockage',
    highlight: false,
    cardText: 'Entrepôts, chambres froides, silos, centres de collecte et solutions de conservation partagée.',
    file: '02-stockage-et-conservation.html',
  },
  {
    order: 3,
    slug: 'logistique-et-commercialisation',
    title: 'Logistique et commercialisation',
    nature: 'physique',
    icon: 'logistique',
    highlight: false,
    cardText: 'Plateformes logistiques, marchés, transport adapté, agrégation et mise en marché.',
    file: '03-logistique-et-commercialisation.html',
  },
  {
    order: 4,
    slug: 'qualite-et-certification',
    title: 'Qualité et certification',
    nature: 'mixte',
    icon: 'qualite',
    highlight: false,
    cardText: 'Laboratoires, contrôle qualité, inspection, traçabilité et mise en conformité.',
    file: '04-qualite-et-certification.html',
  },
  {
    order: 5,
    slug: 'numerique-et-e-commerce',
    title: 'Numérique et e-commerce',
    nature: 'immaterielle',
    icon: 'numerique',
    highlight: false,
    cardText: 'Plateformes digitales, systèmes de gestion et e-commerce au service des MPME.',
    file: '05-numerique-et-e-commerce.html',
  },
  {
    order: 6,
    slug: 'formation-et-conseil',
    title: 'Formation et conseil',
    nature: 'immaterielle',
    icon: 'formation',
    highlight: false,
    cardText: 'Formation, mentorat, assistance technique et accompagnement liés au projet.',
    file: '06-formation-et-conseil.html',
  },
  {
    order: 7,
    slug: 'infrastructure-immaterielle',
    title: 'Infrastructure immatérielle',
    nature: 'immaterielle',
    icon: 'immateriel',
    highlight: false,
    cardText: "Eligible si l'usage est collectif et utile aux MPME, sous validation du programme.",
    file: '07-infrastructure-immaterielle.html',
  },
  {
    order: 8,
    slug: 'et-bien-d-autres',
    title: "Et bien d'autres…",
    nature: 'physique',
    icon: 'autres',
    highlight: true,
    cardText: 'Toute infrastructure à usage collectif ou partagé, sous validation du programme.',
    file: '08-et-bien-d-autres.html',
  },
];

const BAND_CONTENT = {
  title: "Exemples d'infrastructures éligibles",
  intro:
    "Physique ou immatérielle : ce qui compte d'abord est le bénéfice collectif pour plusieurs MPME, dans une chaîne prioritaire ou dans un projet transversal.",
};

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

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textNode(text, extra = {}) {
  return { type: 'text', text, ...extra };
}

function parseInline(html) {
  const nodes = [];
  const regex = /<b>([\s\S]*?)<\/b>/gi;
  let cursor = 0;
  let match;

  while ((match = regex.exec(html))) {
    const plain = decodeHtml(html.slice(cursor, match.index).replace(/<[^>]+>/g, ''));
    if (plain) nodes.push(textNode(plain));

    const boldText = decodeHtml(match[1].replace(/<[^>]+>/g, ''));
    if (boldText) nodes.push(textNode(boldText, { bold: true }));

    cursor = match.index + match[0].length;
  }

  const tail = decodeHtml(html.slice(cursor).replace(/<[^>]+>/g, ''));
  if (tail) nodes.push(textNode(tail));

  return nodes.length ? nodes : [textNode('')];
}

function extractBetween(html, startPattern, endPattern) {
  const start = html.search(startPattern);
  if (start === -1) return null;
  const afterStart = html.slice(start);
  const end = afterStart.search(endPattern);
  if (end === -1) return null;
  return afterStart.slice(0, end);
}

function parseHtmlArticle(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const leadMatch = raw.match(/<p class="lead">([\s\S]*?)<\/p>/i);
  const rtfMatch = raw.match(/<div class="rtf[^"]*">([\s\S]*?)<\/div>\s*<div class="cta">/i);

  if (!leadMatch || !rtfMatch) {
    throw new Error(`Structure HTML inattendue dans ${filePath}`);
  }

  const lead = decodeHtml(leadMatch[1].replace(/<[^>]+>/g, ''));
  const bodyHtml = rtfMatch[1];
  const blocks = [];

  const blockRegex = /<(h2|p|ul)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(bodyHtml))) {
    const tag = blockMatch[1].toLowerCase();
    const inner = blockMatch[2];

    if (tag === 'h2') {
      blocks.push({
        type: 'heading',
        level: 2,
        children: [textNode(decodeHtml(inner.replace(/<[^>]+>/g, '')))],
      });
      continue;
    }

    if (tag === 'p') {
      blocks.push({
        type: 'paragraph',
        children: parseInline(inner),
      });
      continue;
    }

    if (tag === 'ul') {
      const items = [];
      const liRegex = /<li>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(inner))) {
        items.push({
          type: 'list-item',
          children: parseInline(liMatch[1]),
        });
      }

      if (items.length) {
        blocks.push({
          type: 'list',
          format: 'unordered',
          children: items,
        });
      }
    }
  }

  return { lead, body: blocks };
}

function generateDocumentId() {
  return crypto.randomBytes(12).toString('hex');
}

async function ensureInfrastructureType(client, item, parsed) {
  const existing = await client.query(
    `
      SELECT id, document_id
      FROM infrastructure_types
      WHERE slug = $1
      ORDER BY id ASC
    `,
    [item.slug],
  );

  if (existing.rowCount) {
    await client.query(
      `
        UPDATE infrastructure_types
        SET
          title = $1,
          slug = $2,
          "order" = $3,
          nature = $4,
          icon = $5,
          card_text = $6,
          lead = $7,
          body = $8::jsonb,
          highlight = $9,
          updated_at = NOW()
        WHERE slug = $2
      `,
      [
        item.title,
        item.slug,
        item.order,
        item.nature,
        item.icon,
        item.cardText,
        parsed.lead,
        JSON.stringify(parsed.body),
        item.highlight,
      ],
    );
    return { slug: item.slug, action: 'updated' };
  }

  const documentId = generateDocumentId();
  const createdAt = new Date().toISOString();
  const commonValues = [
    documentId,
    item.title,
    item.slug,
    item.order,
    item.nature,
    item.icon,
    item.cardText,
    parsed.lead,
    JSON.stringify(parsed.body),
    item.highlight,
    createdAt,
    createdAt,
  ];

  await client.query(
    `
      INSERT INTO infrastructure_types (
        document_id, title, slug, "order", nature, icon,
        card_text, lead, body, highlight,
        created_at, updated_at, published_at
      ) VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, NULL),
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $12)
    `,
    commonValues,
  );

  return { slug: item.slug, action: 'created' };
}

async function ensureInfrastructureBand(client) {
  const existing = await client.query(
    `
      SELECT id
      FROM infrastructure_band
      ORDER BY id ASC
    `,
  );

  if (existing.rowCount) {
    await client.query(
      `
        UPDATE infrastructure_band
        SET
          title = $1,
          intro = $2,
          updated_at = NOW()
      `,
      [BAND_CONTENT.title, BAND_CONTENT.intro],
    );
    return 'updated';
  }

  const documentId = generateDocumentId();
  const createdAt = new Date().toISOString();
  await client.query(
    `
      INSERT INTO infrastructure_band (
        document_id, title, intro, created_at, updated_at, published_at
      ) VALUES
        ($1, $2, $3, $4, $5, NULL),
        ($1, $2, $3, $4, $5, $5)
    `,
    [documentId, BAND_CONTENT.title, BAND_CONTENT.intro, createdAt, createdAt],
  );

  return 'created';
}

async function main() {
  const client = new Client(getDatabaseConfig());
  await client.connect();

  const htmlRoot = path.join(workspaceRoot, 'MAQUETTE', 'MAQUETTE CLAUDE');
  const results = [];
  for (const item of INFRA_TYPES) {
    const parsed = parseHtmlArticle(path.join(htmlRoot, item.file));
    results.push(await ensureInfrastructureType(client, item, parsed));
  }

  const bandAction = await ensureInfrastructureBand(client);
  await client.end();

  for (const result of results) {
    console.log(`${result.action === 'created' ? 'Création' : 'Mise à jour'}: ${result.slug}`);
  }
  console.log(`${bandAction === 'created' ? 'Création' : 'Mise à jour'}: infrastructure-band`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  parseHtmlArticle,
};

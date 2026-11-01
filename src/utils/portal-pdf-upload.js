'use strict';

// Televersement d'un PDF produit en memoire vers la mediatheque Strapi.
//
// Extrait du controleur de candidature le 1er novembre 2026, quand la validation d'une
// mise a jour de maturation a eu besoin d'en faire autant : le depot initial, le re-depot
// et la maturation produisent tous les trois un PDF de dossier, et doivent le televerser de
// la meme facon. Deux copies de ce code auraient fini par diverger sur le nom de fichier ou
// le nettoyage du temporaire.

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');

/**
 * @param {Buffer} buffer contenu du PDF
 * @param {string} filename nom affiche dans la mediatheque
 * @returns {Promise<object>} le fichier televerse (avec son `id`)
 */
async function uploadPdfBuffer(buffer, filename) {
  const tmpPath = path.join(os.tmpdir(), `subco-${crypto.randomUUID()}.pdf`);
  await fs.writeFile(tmpPath, buffer);

  try {
    const [uploaded] = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: filename, caption: filename, alternativeText: filename } },
      files: {
        filepath: tmpPath,
        originalFilename: filename,
        mimetype: 'application/pdf',
        size: buffer.length,
      },
    });
    return uploaded;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

module.exports = { uploadPdfBuffer };

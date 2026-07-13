'use strict';

// M6 (K1) — a la transmission d'un rapport (statut `transmis`), creer un
// `depouillement-rapport` (a_depouiller) si aucun n'existe pour ce rapport.
// Le Cabinet le saisira/proposera, l'UGP le validera (14.6).
async function ensureDepouillement(strapi, id) {
  if (!id) return;
  const rapport = await strapi.db.query('api::rapport-requis.rapport-requis').findOne({ where: { id }, populate: { depouillement: false } });
  if (!rapport || rapport.statut !== 'transmis') return;
  const existing = await strapi.db.query('api::depouillement-rapport.depouillement-rapport').findOne({ where: { rapportRequis: { id } } });
  if (existing) return;
  await strapi.documents('api::depouillement-rapport.depouillement-rapport').create({
    data: {
      rapportRequis: { connect: [rapport.documentId] },
      statut: 'a_depouiller',
      valeurs: { empT: '', empF: '', empJ: '', empR: '', benef: '', inv: '', incidents: 0, note: '' },
    },
  });
}

module.exports = {
  async afterCreate(event) {
    await ensureDepouillement(strapi, event.result?.id);
  },
  async afterUpdate(event) {
    await ensureDepouillement(strapi, event.result?.id || event.params?.where?.id);
  },
};

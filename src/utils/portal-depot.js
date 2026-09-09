'use strict';

// Historique des versions deposees d'un dossier (Lot 1).
//
// Modele R2 : `donneesProjet` reste TOUJOURS la version deposee ; le travail en cours vit
// dans `donneesProjetTravail`. Un re-depot recopie le travail dans `donneesProjet`, archive
// la version precedente ici, et regenere le PDF. Consequence : les modules d'instruction et
// de suivi-evaluation, qui lisent tous `donneesProjet`, n'ont rien a changer.

const DEPOT_POPULATE = { pdfPermanent: true };

/**
 * Cree l'entree d'historique correspondant a la version ACTUELLEMENT deposee d'un dossier.
 * Ne fait rien si cette version est deja archivee (idempotent).
 */
async function archiverVersionCourante(strapi, candidature, { auteurLibelle = 'Operateur' } = {}) {
  const version = Number(candidature.versionDepot) || 1;

  const deja = await strapi.documents('api::depot-dossier.depot-dossier').findFirst({
    filters: { candidature: { documentId: candidature.documentId }, version },
  });
  if (deja?.documentId) return deja;

  return strapi.documents('api::depot-dossier.depot-dossier').create({
    data: {
      candidature: { connect: [candidature.documentId] },
      version,
      // `dernierDepotLe` est nul sur les dossiers anterieurs au Lot 1 : leur unique depot
      // est le depot initial, donc `dateDepot`.
      deposeLe: candidature.dernierDepotLe || candidature.dateDepot || new Date().toISOString(),
      pdf: candidature.pdfPermanent?.id || null,
      donneesProjet: candidature.donneesProjet || null,
      titreProjet: candidature.titreProjet || null,
      auteurLibelle,
    },
  });
}

/**
 * Backfill au demarrage : donne son historique v1 a tout dossier depose avant le Lot 1.
 *
 * Sans lui, l'historique demarre vide — et « la derniere version deposee » n'aurait rien a
 * quoi revenir le jour ou un candidat rouvre puis abandonne. Idempotent : au deuxieme
 * demarrage il ne cree plus rien.
 */
async function ensureDepotsInitiaux(strapi) {
  const deposees = await strapi.documents('api::candidature.candidature').findMany({
    filters: { numeroDossier: { $notNull: true } },
    populate: DEPOT_POPULATE,
    limit: 2000,
  });
  if (deposees.length === 0) return 0;

  // Un seul appel pour savoir qui a deja un historique, plutot qu'une requete par dossier.
  const existants = await strapi.documents('api::depot-dossier.depot-dossier').findMany({
    populate: { candidature: { fields: ['documentId'] } },
    fields: ['version'],
    limit: 5000,
  });
  const avecHistorique = new Set(existants.map((d) => d.candidature?.documentId).filter(Boolean));

  let crees = 0;

  for (const candidature of deposees) {
    if (avecHistorique.has(candidature.documentId)) continue;

    await archiverVersionCourante(strapi, {
      ...candidature,
      versionDepot: candidature.versionDepot || 1,
    });

    // Les dossiers anterieurs au Lot 1 n'ont ni numero de version ni date de dernier depot :
    // leur unique depot est le depot initial.
    const manquants = {};
    if (!candidature.versionDepot) manquants.versionDepot = 1;
    if (!candidature.dernierDepotLe && candidature.dateDepot) manquants.dernierDepotLe = candidature.dateDepot;

    if (Object.keys(manquants).length > 0) {
      await strapi.documents('api::candidature.candidature').update({
        documentId: candidature.documentId,
        data: manquants,
      });
    }

    crees += 1;
  }

  if (crees > 0) {
    strapi.log.info(`[depots] Historique initial cree pour ${crees} dossier(s) deja deposes.`);
  }

  return crees;
}

/**
 * A la cloture d'un appel : archive les modifications commencees mais JAMAIS deposees.
 *
 * C'est ici que se joue la reponse a « et si la cloture tombe pendant une modification ? ».
 * Avec le modele R2 il n'y a rien a arbitrer : la derniere version DEPOSEE part en
 * instruction, elle n'a jamais cesse d'etre valide. Le travail non depose est conserve
 * (`travailNonDepose`) pour qu'un arbitrage reste possible sur demande, et le candidat est
 * notifie en NOMMANT la version retenue — un message vague ici produirait exactement le
 * litige qu'on cherche a eviter.
 *
 * @returns {Promise<number>} nombre de dossiers dont la modification a ete archivee.
 */
async function archiverModificationsNonDeposees(strapi, appelDocumentId) {
  const enCours = await strapi.documents('api::candidature.candidature').findMany({
    filters: {
      donneesProjetTravail: { $notNull: true },
      ...(appelDocumentId ? { appel: { documentId: appelDocumentId } } : {}),
    },
    populate: { owner: { fields: ['id', 'email', 'phone'] }, organisation: { fields: ['telephone'] } },
    limit: 2000,
  });

  if (enCours.length === 0) return 0;

  const { journal } = require('./portal-instruction');
  const { sendPortalNotification } = require('./portal-notify');
  const maintenant = new Date().toISOString();

  for (const candidature of enCours) {
    const version = Number(candidature.versionDepot) || 1;
    const deposeLe = candidature.dernierDepotLe || candidature.dateDepot;
    const dateLisible = deposeLe ? new Date(deposeLe).toLocaleDateString('fr-FR') : null;

    const archive = await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: {
        travailNonDepose: candidature.donneesProjetTravail,
        travailNonDeposeLe: maintenant,
        donneesProjetTravail: null,
        titreProjetTravail: null,
      },
    });

    await journal(strapi, candidature.documentId, {
      auteurLibelle: 'Systeme',
      type: 'modification_non_deposee',
      texte: `Cloture de l'appel : des modifications non deposees ont ete archivees. La version instruite reste la v${version}.`,
    });

    await sendPortalNotification(strapi, {
      userId: candidature.owner?.id,
      email: candidature.owner?.email,
      telephone: candidature.owner?.phone || candidature.organisation?.telephone,
      candidature: archive,
      sujet: 'Cloture de l\'appel — version retenue de votre dossier',
      corps: `L'appel est clos. Le dossier ${candidature.numeroDossier} est instruit dans sa version ${version}${dateLisible ? `, deposee le ${dateLisible}` : ''}. Les modifications que vous aviez commencees sans les deposer n'ont pas ete retenues ; elles restent conservees et peuvent vous etre communiquees sur demande.`,
    });
  }

  strapi.log.info(`[depots] Cloture : ${enCours.length} modification(s) non deposee(s) archivee(s).`);
  return enCours.length;
}

module.exports = {
  archiverVersionCourante,
  archiverModificationsNonDeposees,
  ensureDepotsInitiaux,
};

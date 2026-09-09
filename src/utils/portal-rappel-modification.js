'use strict';

// Rappels automatiques aux candidats dont la modification de dossier n'est pas deposee.
//
// C'est le garde-fou de prevention du Lot 1. Le modele R2 garantit qu'un candidat ne perd
// jamais sa candidature deposee ; en revanche il peut parfaitement perdre le BENEFICE de ses
// corrections en oubliant de les deposer. Le bandeau permanent du portail ne suffit pas : il
// faut le joindre la ou il est, avant qu'il soit trop tard.

const { clotureDeadline } = require('./portal-appel-cloture');
const { sendTemplate } = require('./mail/mail-service');

// Paliers, du plus lointain au plus proche de l'echeance.
const PALIERS = [
  { cle: 'J-3', heures: 72, libelle: 'dans trois jours' },
  { cle: 'J-1', heures: 24, libelle: 'demain' },
  { cle: 'H-6', heures: 6, libelle: 'dans moins de six heures' },
];

/**
 * Palier applicable pour un temps restant donne : le PLUS URGENT dont le seuil est franchi.
 * @returns {{cle: string, heures: number, libelle: string}|null}
 */
function palierApplicable(heuresRestantes) {
  if (heuresRestantes < 0) return null;
  let choisi = null;
  for (const palier of PALIERS) {
    if (heuresRestantes <= palier.heures) choisi = palier;
  }
  return choisi;
}

/**
 * Paliers a marquer comme traites quand on envoie `cle` : celui-ci ET tous les plus
 * lointains. Sans cela, un candidat qui rouvre a deux heures de la cloture recevrait
 * ensuite un rappel « il vous reste trois jours » — faux et decredibilisant.
 */
function paliersCouverts(cle) {
  const index = PALIERS.findIndex((p) => p.cle === cle);
  return PALIERS.slice(0, index + 1).map((p) => p.cle);
}

async function envoyerRappelsModification(strapi, now = Date.now()) {
  const enCours = await strapi.documents('api::candidature.candidature').findMany({
    filters: { donneesProjetTravail: { $notNull: true } },
    populate: { appel: true, owner: { fields: ['id', 'email'] } },
    limit: 2000,
  });

  let envoyes = 0;

  for (const candidature of enCours) {
    // Un appel deja clos n'a plus de rappel a emettre : la cloture a son propre message,
    // qui nomme la version retenue.
    if (candidature.appel?.statut !== 'ouvert') continue;

    const deadline = clotureDeadline(candidature.appel?.clotureLe);
    if (deadline === null) continue;

    const heuresRestantes = (deadline - now) / 3600000;
    const palier = palierApplicable(heuresRestantes);
    if (!palier) continue;

    const dejaEnvoyes = Array.isArray(candidature.rappelsModification) ? candidature.rappelsModification : [];
    if (dejaEnvoyes.includes(palier.cle)) continue;

    const version = Number(candidature.versionDepot) || 1;
    const sujet = 'Vos modifications ne sont pas encore deposees';
    const corps = `L'appel se cloture ${palier.libelle}. Vos modifications sur le dossier ${candidature.numeroDossier} ne sont PAS deposees : en l'etat, c'est votre version ${version} qui sera instruite. Pour que vos corrections soient prises en compte, ouvrez votre dossier et cliquez sur « Deposer cette version » avant la cloture.`;

    if (candidature.owner?.email) {
      try {
        await sendTemplate('candidate.modification_non_deposee', { sujet, corps }, candidature.owner.email, {
          candidature: candidature.documentId,
        });
      } catch (error) {
        strapi.log.error(`[rappel] Echec d'envoi (${candidature.numeroDossier})`, error);
        // On n'inscrit pas le palier : le prochain passage reessaiera.
        continue;
      }
    }

    // Trace cote portail (cloche + « Suivi de mon dossier »), en plus de l'e-mail.
    await strapi.documents('api::notification.notification').create({
      data: {
        owner: candidature.owner?.id || null,
        candidature: { connect: [candidature.documentId] },
        canal: 'email',
        sujet,
        corps,
        envoyeLe: new Date(now).toISOString(),
        lu: false,
      },
    });

    await strapi.documents('api::candidature.candidature').update({
      documentId: candidature.documentId,
      data: { rappelsModification: [...new Set([...dejaEnvoyes, ...paliersCouverts(palier.cle)])] },
    });

    envoyes += 1;
    strapi.log.info(`[rappel] ${palier.cle} envoye pour ${candidature.numeroDossier}.`);
  }

  return envoyes;
}

module.exports = {
  PALIERS,
  palierApplicable,
  paliersCouverts,
  envoyerRappelsModification,
};

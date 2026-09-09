'use strict';

// Cloture automatique des appels a leur echeance.
//
// Pourquoi ce module existe : la seule ecriture de `statut: 'ferme'` etait, jusqu'ici, le
// clic humain de l'UGP (gestion.cloreAppel). Le champ `clotureLe` n'etait qu'un affichage.
// Or plusieurs gardes metier reposent sur `appel.statut === 'ouvert'` — notamment le droit
// d'ajouter une piece a un dossier deja depose. Sans fermeture effective, ces gardes ne se
// declenchent jamais et l'egalite de traitement n'est plus tenue.
//
// La regle est volontairement ecrite pour TOUTES les cohortes, jamais pour une date
// particuliere : tout appel `ouvert` dont `clotureLe` est depasse passe a `ferme`.

// Le Burundi est a UTC+2 toute l'annee (pas d'heure d'ete) : un decalage fixe est sur ici,
// ce qui ne serait pas le cas sous un fuseau a changement d'heure.
const BUJUMBURA_UTC_OFFSET_HOURS = 2;

/**
 * Instant (ms UTC) a partir duquel un appel dont la cloture est `clotureLe` doit etre ferme.
 *
 * `clotureLe` est un `date` (« 2026-09-12 »), sans heure : la convention est que l'appel
 * reste ouvert jusqu'a la FIN de cette journee a Bujumbura, soit 23h59'59 locales
 * (21h59'59 UTC). L'echeance est donc minuit du LENDEMAIN, heure de Bujumbura.
 *
 * Se tromper de fuseau fermerait l'appel deux heures trop tot — or c'est precisement dans
 * les deux dernieres heures d'un dernier soir que les depots affluent.
 *
 * @returns {number|null} null si la date est absente ou illisible (l'appel n'est alors jamais ferme).
 */
function clotureDeadline(clotureLe) {
  if (!clotureLe) return null;
  const [year, month, day] = String(clotureLe).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  // Date.UTC absorbe les debordements (31 -> jour 1 du mois suivant) et les heures negatives.
  return Date.UTC(year, month - 1, day + 1, -BUJUMBURA_UTC_OFFSET_HOURS, 0, 0, 0);
}

function estEchu(clotureLe, now) {
  const deadline = clotureDeadline(clotureLe);
  return deadline !== null && now >= deadline;
}

/**
 * Ferme les appels ouverts dont l'echeance est passee. Idempotent : un appel deja `ferme`
 * n'est jamais reecrit.
 *
 * @returns {Promise<string[]>} codes des cohortes effectivement fermees (vide le plus souvent).
 */
async function cloreAppelsEchus(strapi, now = Date.now()) {
  // Le filtre `statut: 'ouvert'` n'est PAS une optimisation, c'est la condition pour ne pas
  // declencher en boucle : chaque `update` sur un appel reveille l'afterUpdate abonne dans
  // src/index.js (notifications AMI) ET le webhook de revalidation du portail. Sans ce
  // filtre, la tache reecrirait `ferme` a chaque passage, indefiniment.
  const ouverts = await strapi.documents('api::appel.appel').findMany({
    filters: { statut: 'ouvert' },
    limit: 50,
  });

  const fermes = [];

  for (const appel of ouverts) {
    if (!estEchu(appel.clotureLe, now)) continue;

    // Meme chemin d'ecriture que le bouton « Clore » de l'UGP (gestion.cloreAppel) :
    // aucune surface d'effet de bord nouvelle.
    await strapi.documents('api::appel.appel').update({
      documentId: appel.documentId,
      data: { statut: 'ferme' },
      status: 'published',
    });

    const code = appel.codeCohorte || appel.documentId;
    fermes.push(code);
    strapi.log.info(`[cloture] Appel ${code} ferme automatiquement (cloture le ${appel.clotureLe}).`);
  }

  return fermes;
}

module.exports = {
  BUJUMBURA_UTC_OFFSET_HOURS,
  clotureDeadline,
  estEchu,
  cloreAppelsEchus,
};

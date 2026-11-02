'use strict';

// Parcours operateur. Trois routes, toutes owner-scopees : un operateur ne voit et ne
// sert que les demandes portant sur SES dossiers. Le router core reste ferme — aucune
// permission publique n'est ouverte sur ce type de contenu.

const { createCoreController } = require('@strapi/strapi').factories;
const { getUserId } = require('../../../utils/portal-owner');
const { soumettreDemande } = require('../../../utils/maturation');
const { catalogueChamps, champsDuPerimetre } = require('../../../utils/maturation-champs');

const UID = 'api::demande-maj.demande-maj';

const POPULATE = {
  type: { fields: ['code', 'libelle', 'phase'] },
  // `donneesProjet` sert a pre-remplir le formulaire avec les valeurs actuelles : sans
  // elles, l'operateur devrait ressaisir de memoire ce qu'il avait depose.
  candidature: { fields: ['documentId', 'numeroDossier', 'titreProjet', 'donneesProjet'], populate: { owner: { fields: ['id'] } } },
};

/** Charge une demande en verifiant qu'elle appartient bien a l'operateur connecte. */
async function chargerPossedee(strapi, documentId, userId) {
  const demande = await strapi.documents(UID).findOne({ documentId, populate: POPULATE });
  if (!demande?.documentId) return null;
  if (String(demande.candidature?.owner?.id) !== String(userId)) return null;
  return demande;
}

/** Ce que l'operateur a le droit de voir : jamais les champs de decision interne. */
// Meme raison que cote equipe : `fileId` brut, pas de relation media. Sans resolution,
// l'operateur ne peut pas relire la piece qu'il a deposee.
async function resoudrePieces(strapi, vues) {
  const liste = Array.isArray(vues) ? vues : [vues];
  const ids = [...new Set(
    liste.flatMap((v) => (v?.piecesFournies || []).map((p) => Number(p?.fileId)))
      .filter((n) => Number.isInteger(n) && n > 0),
  )];
  if (ids.length === 0) return vues;

  const fichiers = await strapi.db.query('plugin::upload.file').findMany({
    where: { id: { $in: ids } },
    select: ['id', 'name', 'url'],
  });
  const parId = new Map(fichiers.map((f) => [Number(f.id), f]));

  for (const v of liste) {
    if (!v?.piecesFournies) continue;
    v.piecesFournies = v.piecesFournies.map((p) => {
      const f = parId.get(Number(p?.fileId));
      return f ? { ...p, url: f.url, nomFichier: p.nomFichier || f.name } : p;
    });
  }
  return vues;
}

/**
 * Decrit les champs ouverts par la demande : libelle, type, valeurs admises, valeur
 * actuelle au dossier et valeur deja proposee. Le formulaire ne sait rien du catalogue —
 * il affiche ce que le CMS lui decrit, ce qui evite deux definitions a tenir d'accord.
 */
function decrireChamps(demande, parCle) {
  const donnees = demande.candidature?.donneesProjet || {};
  const proposees = demande.valeursProposees || {};
  return champsDuPerimetre(demande.perimetre).map((champ) => {
    const [section, nom] = champ.cle.split('.');
    const enrichi = parCle.get(champ.cle) || champ;
    return {
      cle: champ.cle,
      libelle: enrichi.libelle,
      section: enrichi.section,
      type: enrichi.type,
      options: enrichi.options || null,
      max: enrichi.max || null,
      valeurActuelle: donnees?.[section]?.[nom] ?? null,
      valeurProposee: proposees[champ.cle] ?? null,
    };
  });
}

function vueOperateur(demande) {
  return {
    documentId: demande.documentId,
    statut: demande.statut,
    phase: demande.phase,
    echeance: demande.echeance,
    texteDemande: demande.texteDemande,
    perimetre: demande.perimetre,
    piecesFournies: demande.piecesFournies || [],
    valeursProposees: demande.valeursProposees || null,
    montantsProposes: demande.montantsProposes || null,
    montantsStatut: demande.montantsStatut,
    motifRenvoi: demande.motifRenvoi || null,
    soumisLe: demande.soumisLe,
    champs: [],
    type: demande.type ? { libelle: demande.type.libelle, phase: demande.type.phase } : null,
    candidature: demande.candidature
      ? { documentId: demande.candidature.documentId, numeroDossier: demande.candidature.numeroDossier, titreProjet: demande.candidature.titreProjet }
      : null,
  };
}

module.exports = createCoreController(UID, ({ strapi }) => ({
  async mesDemandes(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return ctx.unauthorized('Authentification requise.');

    const demandes = await strapi.documents(UID).findMany({
      filters: { candidature: { owner: { id: userId } } },
      populate: POPULATE,
      sort: ['echeance:asc'],
      limit: 100,
    });
    const parCle = new Map((await catalogueChamps(strapi)).map((c) => [c.cle, c]));
    const vues = demandes.map((d) => ({ ...vueOperateur(d), champs: decrireChamps(d, parCle) }));
    await resoudrePieces(strapi, vues);
    ctx.body = { demandes: vues };
  },

  async detail(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return ctx.unauthorized('Authentification requise.');
    const demande = await chargerPossedee(strapi, ctx.params.documentId, userId);
    if (!demande) return ctx.notFound('Demande introuvable.');
    const parCle = new Map((await catalogueChamps(strapi)).map((c) => [c.cle, c]));
    const vue = { ...vueOperateur(demande), champs: decrireChamps(demande, parCle) };
    await resoudrePieces(strapi, vue);
    ctx.body = { demande: vue };
  },

  /**
   * Depot de la reponse. N'ecrit RIEN sur le dossier : tant que l'equipe n'a pas valide,
   * les montants officiels restent ceux du depot. C'est la regle qui empeche un operateur
   * de modifier seul les chiffres de son projet.
   */
  async soumettre(ctx) {
    const userId = getUserId(ctx);
    if (!userId) return ctx.unauthorized('Authentification requise.');
    const demande = await chargerPossedee(strapi, ctx.params.documentId, userId);
    if (!demande) return ctx.notFound('Demande introuvable.');

    if (demande.echeance && new Date(demande.echeance).getTime() < Date.now()) {
      return ctx.badRequest("L'echeance de cette demande est passee. Ecrivez a candidature@subco-prete.bi pour qu'elle soit rouverte.");
    }

    const { pieces, montants, valeurs } = ctx.request.body || {};
    try {
      const misAJour = await soumettreDemande(strapi, demande, { pieces, montants, valeurs });
      const complet = { ...misAJour, type: demande.type, candidature: demande.candidature };
      const parCle = new Map((await catalogueChamps(strapi)).map((c) => [c.cle, c]));
      const vue = { ...vueOperateur(complet), champs: decrireChamps(complet, parCle) };
      await resoudrePieces(strapi, vue);
      ctx.body = { demande: vue };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },
}));

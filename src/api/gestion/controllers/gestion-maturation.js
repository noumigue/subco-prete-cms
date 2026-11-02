'use strict';

// ============================================================================
// Demandes de mise a jour d'un dossier deja depose — cote equipe.
//
// QUI PEUT QUOI. « Le Cabinet OU l'UGP valide » (arbitrage du 29 octobre) : la validation
// n'est pas une chaine a deux temps, c'est un droit porte par deux roles. Aucune condition
// d'attribution non plus — n'importe quel membre de l'equipe valide n'importe quel dossier.
// C'est un ecart assume avec la regle d'instruction, ou seul l'instructeur en charge
// instruit ; d'ou l'importance de tracer QUI a valide, ce que fait `validePar`.
// ============================================================================

const {
  creerDemandes,
  validerDemande,
  renvoyerDemande,
  rouvrirDemande,
  echeanceOuvree,
  perimetreDepuisType,
  verifierGenre,
  libelleObjet,
  cleObjet,
  GENRES,
} = require('../../../utils/maturation');

const UID = 'api::demande-maj.demande-maj';
const UID_TYPE = 'api::type-demande-maj.type-demande-maj';
const UID_TYPE_PIECE = 'api::type-piece.type-piece';

const crypto = require('crypto');
const { catalogueChamps, normaliserChamps, champsDuPerimetre, CATALOGUE } = require('../../../utils/maturation-champs');

function slug(libelle) {
  return String(libelle || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'demande';
}

/**
 * Le type de demande, decrit depuis le genre choisi a l'ecran — SANS ecrire en base.
 *
 * L'equipe ne passe pas par l'admin : elle choisit un genre, nomme son objet, et le type
 * se deduit. C'est ce qui rend le genre « piece d'un type non existant » reellement
 * utilisable — sinon chaque nouvelle piece demanderait une intervention technique.
 *
 * La simulation s'en sert telle quelle : elle doit pouvoir annoncer ce qui partira sans
 * rien creer, puisque c'est la promesse faite a l'ecran.
 */
async function typeVirtuel(strapi, { genre, champs, libellePiece, typePieceDocumentId, texteDemande, joursOuvres }) {
  if (!GENRES.includes(genre)) throw new Error(`Genre inconnu : ${genre}.`);

  if (genre === 'champs') {
    // La selection est normalisee ici : une cle hors catalogue est refusee avant que la
    // campagne ne parte. C'est la garde qui empeche une ecriture arbitraire dans les
    // donnees d'un dossier deja depose, note et passe au Comite.
    const cles = normaliserChamps(champs);
    const libelles = cles.map((c) => CATALOGUE.find((x) => x.cle === c)?.libelle || c);
    const resume = libelles.join(', ');
    return {
      genre,
      libelle: `Modifier : ${resume.length > 70 ? `${libelles.slice(0, 2).join(', ')} et ${libelles.length - 2} autre(s)` : resume}`,
      // Le code identifie la SELECTION, pas son libelle : deux campagnes portant sur des
      // champs differents ne doivent pas se confondre, et relancer la meme selection doit
      // reutiliser le meme type plutot qu'en empiler des variantes.
      codeStable: `champs-${crypto.createHash('md5').update(cles.join('|')).digest('hex').slice(0, 10)}`,
      montantsOuverts: false, champsOuverts: cles,
      piecesAttendues: [], piecesLibres: [],
      texteDemande: texteDemande || null, delaiJoursDefaut: joursOuvres || 5, phase: 'maturation',
    };
  }

  if (genre === 'piece_nouvelle') {
    const nom = String(libellePiece || '').trim();
    if (!nom) throw new Error('Le libelle de la piece a fournir est requis.');
    // Refus explicite si le libelle existe deja au referentiel : c'est alors une revision,
    // pas une piece nouvelle, et les deux ne se rangent pas au meme endroit a l'ecran.
    const deja = await strapi.documents(UID_TYPE_PIECE).findMany({ fields: ['libelle'], limit: 100 });
    const normalise = (v) => String(v || '').trim().toLowerCase();
    if (deja.some((p) => normalise(p.libelle) === normalise(nom))) {
      throw new Error(`« ${nom} » existe deja au referentiel des pieces. Lancez une campagne « nouvelle version d'une piece existante ».`);
    }
    return {
      genre, libelle: nom, montantsOuverts: false, champsOuverts: [],
      piecesAttendues: [], piecesLibres: [{ libelle: nom, groupe: 'financier', exigence: 'obligatoire' }],
      texteDemande: texteDemande || null, delaiJoursDefaut: joursOuvres || 5, phase: 'maturation',
    };
  }

  const piece = typePieceDocumentId
    ? await strapi.documents(UID_TYPE_PIECE).findOne({ documentId: typePieceDocumentId })
    : null;
  if (!piece?.documentId) throw new Error('Piece a reviser introuvable au referentiel.');
  return {
    genre, libelle: `Nouvelle version — ${piece.libelle}`,
    montantsOuverts: false, champsOuverts: [],
    piecesAttendues: [{ documentId: piece.documentId, libelle: piece.libelle, groupe: piece.groupe, exigence: piece.exigence }],
    piecesLibres: [],
    texteDemande: texteDemande || null, delaiJoursDefaut: joursOuvres || 5, phase: 'maturation',
  };
}

/** Cree le type s'il n'existe pas encore, le reutilise sinon. Idempotent par `code`. */
async function assurerType(strapi, virtuel) {
  const code = virtuel.codeStable || slug(`${virtuel.genre}-${virtuel.libelle}`);
  const existant = await strapi.documents(UID_TYPE).findFirst({ filters: { code } });
  if (existant?.documentId) return existant.documentId;

  const cree = await strapi.documents(UID_TYPE).create({
    data: {
      code, genre: virtuel.genre, libelle: virtuel.libelle, phase: 'maturation',
      texteDemande: virtuel.texteDemande, montantsOuverts: virtuel.montantsOuverts,
      champsOuverts: virtuel.champsOuverts, piecesLibres: virtuel.piecesLibres,
      ...(virtuel.piecesAttendues.length
        ? { piecesAttendues: { connect: virtuel.piecesAttendues.map((p) => p.documentId) } }
        : {}),
      delaiJoursDefaut: virtuel.delaiJoursDefaut, validationRequise: true, actif: true,
    },
    status: 'published',
  });
  return cree.documentId;
}

const ECRITURE = ['instructeur', 'ugp'];
const LECTURE = ['instructeur', 'ugp', 'comite'];

function requireRole(ctx, roles) {
  const user = ctx.state?.user;
  const roleType = user?.role?.type;
  if (!user || !roleType) { ctx.unauthorized('Authentification requise.'); return null; }
  if (!roles.includes(roleType)) { ctx.forbidden("Action reservee a l'equipe du projet."); return null; }
  return user;
}

// Une piece deposee porte un `fileId` brut, pas une relation media : sans resolution,
// l'ecran affiche un nom de fichier qu'on ne peut pas ouvrir. L'equipe doit lire le plan
// de financement pour le valider — c'est tout l'objet de l'examen.
async function resoudrePieces(strapi, demandes) {
  const liste = Array.isArray(demandes) ? demandes : [demandes];
  const ids = [...new Set(
    liste.flatMap((d) => (d?.piecesFournies || []).map((p) => Number(p?.fileId)))
      .filter((n) => Number.isInteger(n) && n > 0),
  )];
  if (ids.length === 0) return demandes;

  const fichiers = await strapi.db.query('plugin::upload.file').findMany({
    where: { id: { $in: ids } },
    select: ['id', 'name', 'url', 'mime', 'size'],
  });
  const parId = new Map(fichiers.map((f) => [Number(f.id), f]));

  for (const d of liste) {
    if (!d?.piecesFournies) continue;
    d.piecesFournies = d.piecesFournies.map((p) => {
      const f = parId.get(Number(p?.fileId));
      return f
        ? { ...p, url: f.url, nomFichier: p.nomFichier || f.name, mime: f.mime || null, tailleKo: f.size ? Math.round(f.size) : null }
        : p;
    });
  }
  return demandes;
}

/**
 * Decrit, pour l'equipe, ce qui est propose champ par champ : l'ancienne valeur et la
 * nouvelle, cote a cote. Sans ce rapprochement l'ecran afficherait des cles pointees et un
 * nombre nu — on ne valide pas ce qu'on ne peut pas comparer.
 */
async function decrireValeursProposees(strapi, demandes) {
  const liste = Array.isArray(demandes) ? demandes : [demandes];
  const concernees = liste.filter((d) => champsDuPerimetre(d?.perimetre).length > 0);
  if (concernees.length === 0) return demandes;
  const parCle = new Map((await catalogueChamps(strapi)).map((c) => [c.cle, c]));

  for (const d of concernees) {
    const proposees = d.valeursProposees || (d.montantsProposes
      ? {
        'financement.budgetTotal': d.montantsProposes.budgetTotal,
        'financement.contrepartie': d.montantsProposes.contrepartie,
        ...(d.montantsProposes.typeContrepartie ? { 'financement.typeContrepartie': d.montantsProposes.typeContrepartie } : {}),
      }
      : {});
    const donnees = d.candidature?.donneesProjet || {};
    d.valeursDecrites = champsDuPerimetre(d.perimetre).map((champ) => {
      const [section, nom] = champ.cle.split('.');
      return {
        cle: champ.cle,
        libelle: parCle.get(champ.cle)?.libelle || champ.libelle,
        actuelle: donnees?.[section]?.[nom] ?? null,
        proposee: proposees[champ.cle] ?? null,
      };
    });
  }
  return demandes;
}

function libelleAuteur(user) {
  return [user?.prenom, user?.nom].filter(Boolean).join(' ').trim() || user?.username || user?.email || 'Equipe';
}

const POPULATE = {
  type: { fields: ['code', 'libelle', 'phase'] },
  candidature: {
    fields: ['documentId', 'numeroDossier', 'titreProjet', 'versionDepot', 'montantsMatures', 'donneesProjet'],
    populate: { organisation: { fields: ['nom'] }, statut: { fields: ['code', 'libelleCandidat'] } },
  },
};

async function charger(strapi, documentId) {
  return strapi.documents(UID).findOne({ documentId, populate: POPULATE });
}


/**
 * Resout une liste melee de numeros de dossier et d'identifiants de document vers des
 * documentId. L'equipe travaille avec des numeros — « PRETE-AP-C1-2026-00127 », ou meme
 * « 00127 » — et c'est ce qu'elle colle dans le formulaire.
 */
async function resoudreDossiers(strapi, entrees) {
  const brut = (Array.isArray(entrees) ? entrees : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const documentIds = [];
  const introuvables = [];

  for (const entree of brut) {
    const numero = /^\d{5}$/.test(entree) ? `PRETE-AP-C1-2026-${entree}` : entree;
    if (/^PRETE-AP-C1-\d{4}-\d{5}$/.test(numero)) {
      const dossier = await strapi.documents('api::candidature.candidature').findFirst({
        filters: { numeroDossier: numero },
        fields: ['documentId'],
      });
      if (dossier?.documentId) documentIds.push(dossier.documentId);
      else introuvables.push(entree);
    } else {
      documentIds.push(entree);
    }
  }
  return { documentIds: [...new Set(documentIds)], introuvables };
}

module.exports = {
  /** Referentiel des types, pour le formulaire de campagne. */
  async types(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const types = await strapi.documents(UID_TYPE).findMany({
      filters: { actif: { $ne: false } },
      populate: { piecesAttendues: { fields: ['libelle', 'groupe', 'exigence'] } },
      sort: ['ordre:asc', 'libelle:asc'],
      limit: 200,
    });
    ctx.body = { types };
  },

  /** Champs du formulaire qu'une campagne peut rouvrir, groupes par section. */
  async champsReferentiel(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    ctx.body = { champs: await catalogueChamps(strapi) };
  },

  /** Pieces du referentiel, pour choisir celle dont on veut une nouvelle version. */
  async piecesReferentiel(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const pieces = await strapi.documents(UID_TYPE_PIECE).findMany({
      fields: ['libelle', 'groupe', 'exigence'],
      sort: ['ordre:asc'],
      limit: 100,
    });
    ctx.body = { pieces: pieces.map((p) => ({ documentId: p.documentId, libelle: p.libelle, groupe: p.groupe })) };
  },

  /** La file des demandes, filtrable. */
  async file(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const { statut, campagne, phase } = ctx.query || {};
    const filters = {};
    if (statut) filters.statut = { $in: String(statut).split(',') };
    if (campagne) filters.campagne = campagne;
    if (phase) filters.phase = phase;

    const demandes = await strapi.documents(UID).findMany({
      filters,
      populate: POPULATE,
      sort: ['echeance:asc'],
      limit: 1000,
    });

    const compte = demandes.reduce((acc, d) => {
      acc[d.statut] = (acc[d.statut] || 0) + 1;
      return acc;
    }, {});
    await resoudrePieces(strapi, demandes);
    await decrireValeursProposees(strapi, demandes);
    ctx.body = { demandes, compte, total: demandes.length };
  },

  async demande(ctx) {
    if (!requireRole(ctx, LECTURE)) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    await resoudrePieces(strapi, demande);
    await decrireValeursProposees(strapi, demande);
    ctx.body = { demande };
  },

  /**
   * Cree une campagne : une demande par dossier vise.
   * La cle de campagne dedoublonne — relancer une campagne interrompue ne cree pas de
   * seconde demande sur les dossiers deja servis.
   */
  async campagne(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const corps = ctx.request.body?.data || ctx.request.body || {};
    const { typeDocumentId, candidatures, campagne, echeance, joursOuvres } = corps;
    if (!typeDocumentId && !corps.genre) return ctx.badRequest('Genre de campagne requis.');
    if (!Array.isArray(candidatures) || candidatures.length === 0) {
      return ctx.badRequest('Aucun dossier vise.');
    }
    if (!campagne || !/^[a-z0-9][a-z0-9._-]{2,48}$/.test(String(campagne))) {
      return ctx.badRequest('Cle de campagne invalide (3 a 49 caracteres : a-z, 0-9, . _ -).');
    }

    const { documentIds, introuvables } = await resoudreDossiers(strapi, candidatures);
    if (introuvables.length > 0) {
      return ctx.badRequest(`Dossier(s) introuvable(s) : ${introuvables.join(', ')}`);
    }

    try {
      // Un type existant se reutilise tel quel ; un genre choisi a l'ecran se materialise
      // en type a cet instant seulement — apres la simulation, et une seule fois.
      const idType = typeDocumentId || await assurerType(strapi, await typeVirtuel(strapi, corps));
      const bilan = await creerDemandes(strapi, {
        typeDocumentId: idType,
        candidatureDocumentIds: documentIds,
        campagne: String(campagne),
        echeance: echeance || null,
        joursOuvres: joursOuvres || null,
        demandeePar: libelleAuteur(user),
      });
      ctx.body = bilan;
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },

  /** Simulation : ce que la campagne ferait, sans rien creer. */
  async simulation(ctx) {
    if (!requireRole(ctx, ECRITURE)) return;
    const corps = ctx.request.body?.data || ctx.request.body || {};
    const { typeDocumentId, candidatures, campagne, joursOuvres } = corps;

    // Deux provenances, une seule suite : un type deja au referentiel, ou le genre choisi
    // a l'ecran. Dans le second cas RIEN n'est ecrit — la simulation promet que rien ne part.
    let type;
    let perimetre;
    try {
      type = typeDocumentId
        ? await strapi.documents(UID_TYPE).findOne({ documentId: typeDocumentId, populate: { piecesAttendues: true } })
        : await typeVirtuel(strapi, corps);
      if (!type) return ctx.badRequest('Type de demande introuvable.');
      perimetre = perimetreDepuisType(type);
      // L'apercu doit refuser ce que la creation refuserait : voir le motif avant l'envoi,
      // pas apres.
      verifierGenre(type, perimetre);
    } catch (error) {
      return ctx.badRequest(error.message);
    }

    const { documentIds: vises, introuvables } = await resoudreDossiers(strapi, candidatures);
    const deja = campagne
      ? await strapi.documents(UID).findMany({
        filters: { campagne, candidature: { documentId: { $in: vises } } },
        populate: { candidature: { fields: ['documentId', 'numeroDossier'] } },
        limit: 1000,
      })
      : [];
    const dejaIds = new Set(deja.map((d) => d.candidature?.documentId));

    // Les dossiers portant deja une demande ouverte SUR LE MEME OBJET. Une demande ouverte
    // sur un autre objet ne gene pas : c'est tout l'interet d'une campagne par element.
    const ouvertes = vises.length > 0
      ? await strapi.documents(UID).findMany({
        filters: { candidature: { documentId: { $in: vises } }, statut: { $in: ['demandee', 'renvoyee', 'fournie'] } },
        fields: ['documentId', 'statut', 'perimetre'],
        populate: { candidature: { fields: ['documentId', 'numeroDossier'] } },
        limit: 1000,
      })
      : [];
    const memeObjet = ouvertes.filter((d) => cleObjet(d.perimetre) === cleObjet(perimetre));
    const ouvertesIds = new Set(memeObjet.map((d) => d.candidature?.documentId));

    ctx.body = {
      type: { libelle: type.libelle, phase: type.phase, genre: perimetre.genre },
      objet: libelleObjet(perimetre),
      echeance: echeanceOuvree(joursOuvres || type.delaiJoursDefaut || 5),
      vises: vises.length,
      introuvables,
      aCreer: vises.filter((id) => !dejaIds.has(id) && !ouvertesIds.has(id)).length,
      dejaServis: deja.map((d) => d.candidature?.numeroDossier).filter(Boolean),
      demandeEnCours: memeObjet.map((d) => d.candidature?.numeroDossier).filter(Boolean),
      autresDemandesOuvertes: ouvertes.length - memeObjet.length,
      pieces: perimetre.pieces.map((p) => p.libelle),
      montantsOuverts: perimetre.montants,
    };
  },

  async valider(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    try {
      const { demande: misAJour, dejaValidee } = await validerDemande(strapi, demande, {
        par: libelleAuteur(user),
        role: user.role?.type === 'ugp' ? 'UGP' : 'Cabinet',
      });
      ctx.body = { demande: misAJour, dejaValidee };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },

  async renvoyer(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    const { motif, joursOuvres, echeance } = ctx.request.body?.data || ctx.request.body || {};
    try {
      ctx.body = { demande: await renvoyerDemande(strapi, demande, { motif, joursOuvres, echeance, par: libelleAuteur(user) }) };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },

  async rouvrir(ctx) {
    const user = requireRole(ctx, ECRITURE);
    if (!user) return;
    const demande = await charger(strapi, ctx.params.documentId);
    if (!demande?.documentId) return ctx.notFound('Demande introuvable.');
    const { joursOuvres, echeance } = ctx.request.body?.data || ctx.request.body || {};
    try {
      ctx.body = { demande: await rouvrirDemande(strapi, demande, { joursOuvres, echeance, par: libelleAuteur(user) }) };
    } catch (error) {
      ctx.badRequest(error.message);
    }
  },
};

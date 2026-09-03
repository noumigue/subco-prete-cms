'use strict';

// Construction du bloc « pieces manquantes » injecte dans `campagne.relance_pieces`.
//
// Pourquoi ici et pas dans le template : le renderer ne boucle pas ({{#each}} n'existe
// pas, cf. renderer.js). Le groupement et le tri sont donc faits en amont, une fois, et
// injectes en deux formes — texte brut et HTML. C'est aussi ce qui permet de rendre le
// MEME contenu pour un candidat qui n'a rien depose et pour un qui a 8 pieces sur 15 :
// seule la liste change, le template ne bouge pas.
//
// Entree attendue : les entrees de `donneesProjet.pieces` NON deposees, chacune
// { libelle, exigence } — `exigence` valant `obligatoire`, `si_applicable`, `si_disponible`.

const GROUPES = [
  { exigence: 'obligatoire', titre: 'Obligatoire', couleur: '#b45309', fond: '#fdf6e7' },
  { exigence: 'si_applicable', titre: 'Si applicable', couleur: '#3f6212', fond: '#f4f7ec' },
  { exigence: 'si_disponible', titre: 'Si disponible', couleur: '#334155', fond: '#f1f5f9' },
];

// Les libelles du referentiel sont SANS ACCENTS — convention historique de `type-piece`,
// documentee dans portal-seed.js : upsertDocument retrouve les entrees PAR LIBELLE, donc
// les reaccentuer en base creerait des doublons. Acceptable dans un ecran d'administration,
// pas dans un courrier adresse a un dirigeant d'entreprise. On restitue donc les accents a
// l'AFFICHAGE seulement, sans jamais toucher a la cle. Un libelle absent de la table passe
// tel quel : un nouveau type de piece s'affichera brut plutot que de disparaitre.
const LIBELLES_ACCENTUES = {
  "Attestation d'existence legale (RC / acte constitutif)": "Attestation d'existence légale (RC / acte constitutif)",
  "Numero d'identification fiscale (NIF)": "Numéro d'identification fiscale (NIF)",
  "Numero de l'INSS": "Numéro de l'INSS",
  "Declaration de conflit d'interet": "Déclaration de conflit d'intérêt",
  'Etats financiers recents (3 exercices)': 'États financiers récents (3 exercices)',
  'Releves bancaires des 6 derniers mois': 'Relevés bancaires des 6 derniers mois',
  "Plan d'affaires / budget detaille": "Plan d'affaires / budget détaillé",
  'Liste des beneficiaires potentiels': 'Liste des bénéficiaires potentiels',
  'Preuve de disponibilite du site': 'Preuve de disponibilité du site',
};

function libelleAffiche(libelle) {
  return LIBELLES_ACCENTUES[libelle] || libelle;
}

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

// Regroupe en preservant l'ordre du referentiel (les pieces arrivent deja triees par
// `ordre` cote extraction ; on ne re-trie pas alphabetiquement, ce qui casserait la
// correspondance visuelle avec l'ecran de l'etape 4).
function grouper(pieces) {
  const liste = Array.isArray(pieces) ? pieces : [];
  return GROUPES.map((g) => ({
    ...g,
    items: liste.filter((p) => String(p?.exigence || '').toLowerCase() === g.exigence),
  })).filter((g) => g.items.length > 0);
}

// Accord en nombre. Le moteur de rendu ne connait ni aide ni condition sur un ENTIER
// (seulement la verite/faussete), donc « 1 piece » vs « 9 pieces » ne peut pas se decider
// dans le template : on pre-rend la formule ici. C'est la meme raison qui fait pre-rendre
// la liste des pieces — tout ce qui demande une regle va dans le code, le template
// n'interpole que des chaines pretes.
function pluriel(n, singulier, plurielMot) {
  const nombre = Number(n) || 0;
  return `${nombre} ${nombre >= 2 ? plurielMot : singulier}`;
}

const textePieces = (n) => pluriel(n, 'pièce', 'pièces');
const texteJours = (n) => pluriel(n, 'jour', 'jours');

function buildPiecesBlocks(pieces) {
  const groupes = grouper(pieces);
  const nbManquantes = groupes.reduce((n, g) => n + g.items.length, 0);
  const nbObligatoires = (groupes.find((g) => g.exigence === 'obligatoire')?.items || []).length;

  const piecesTexte = groupes
    .map((g) => [`${g.titre.toUpperCase()} (${g.items.length})`, ...g.items.map((p) => `  - ${libelleAffiche(p.libelle)}`)].join('\n'))
    .join('\n\n');

  const piecesHtml = groupes
    .map(
      (g) => `
      <div style="margin:0 0 14px;padding:12px 14px;background:${g.fond};border-radius:8px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${g.couleur};margin-bottom:8px;">${g.titre} — ${g.items.length}</div>
        <ul style="margin:0;padding-left:20px;line-height:1.7;">
          ${g.items.map((p) => `<li>${escapeHtml(libelleAffiche(p.libelle))}</li>`).join('\n          ')}
        </ul>
      </div>`
    )
    .join('\n');

  return { piecesTexte, piecesHtml, nbManquantes, nbObligatoires, nbManquantesTexte: textePieces(nbManquantes) };
}

// --- Variante « preparation » : groupee par NATURE, pas par exigence ------------------
// Pour un candidat qui n'a pas encore ouvert de dossier, la question n'est pas « qu'est-ce
// qui me manque » mais « ou vais-je chercher tout ca ». Or on ne reunit pas des pieces par
// degre d'obligation : on va au greffe, puis a la banque, puis chez le comptable. Le
// groupement par nature (administratif / financier / technique) suit ce parcours reel ;
// l'exigence devient une simple mention en fin de ligne.
const NATURES = [
  { groupe: 'administratif', titre: 'Administratives', couleur: '#b45309', fond: '#fdf6e7' },
  { groupe: 'financier', titre: 'Financières', couleur: '#3f6212', fond: '#f4f7ec' },
  { groupe: 'technique', titre: 'Techniques', couleur: '#334155', fond: '#f1f5f9' },
];

const MENTION = {
  obligatoire: 'obligatoire',
  si_applicable: 'si applicable',
  si_disponible: 'si disponible',
};

function buildPiecesParNature(pieces) {
  const liste = Array.isArray(pieces) ? pieces : [];
  const groupes = NATURES.map((n) => ({
    ...n,
    items: liste.filter((p) => String(p?.groupe || '').toLowerCase() === n.groupe),
  })).filter((n) => n.items.length > 0);

  const total = liste.length;
  const nbObligatoires = liste.filter((p) => p?.exigence === 'obligatoire').length;

  const piecesTexte = groupes
    .map((g) =>
      [
        `${g.titre.toUpperCase()} (${g.items.length})`,
        ...g.items.map((p) => `  - ${libelleAffiche(p.libelle)} [${MENTION[p.exigence] || p.exigence}]`),
      ].join('\n')
    )
    .join('\n\n');

  const piecesHtml = groupes
    .map(
      (g) => `
      <div style="margin:0 0 14px;padding:12px 14px;background:${g.fond};border-radius:8px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${g.couleur};margin-bottom:8px;">${g.titre} — ${g.items.length}</div>
        <ul style="margin:0;padding-left:20px;line-height:1.7;">
          ${g.items
            .map(
              (p) =>
                `<li>${escapeHtml(libelleAffiche(p.libelle))} <span style="color:#6b7280;font-size:12px;">(${MENTION[p.exigence] || p.exigence})</span></li>`
            )
            .join('\n          ')}
        </ul>
      </div>`
    )
    .join('\n');

  return { piecesTexte, piecesHtml, total, nbObligatoires, totalTexte: textePieces(total) };
}

module.exports = { buildPiecesBlocks, buildPiecesParNature, libelleAffiche, pluriel, textePieces, texteJours, GROUPES, NATURES };

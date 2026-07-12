'use strict';

// Helpers de la phase 2 (évaluation & consolidation, Manuel §6). Le barème et les
// paramètres vivent en référentiel (E1/E4 réversibles) ; ce module ne porte que le
// calcul (totaux, bande 6.2.1.1, détection d'écart ≥ ecartPct) — jamais de valeur en dur.

const DEFAULT_BANDES = [
  { min: 80, label: 'Recommandé pour financement' },
  { min: 70, label: 'Recommandé sous conditions' },
  { min: 60, label: "Liste d'attente / révision" },
  { min: 0, label: 'Non retenu (< 60)' },
];

async function getBareme(strapi) {
  const rows = await strapi.documents('api::critere-evaluation.critere-evaluation').findMany({ sort: ['ordre:asc'], limit: 100 });
  const map = rows.map((c) => ({ code: c.code, bloc: c.bloc, libelle: c.libelle, description: c.description || '', points: c.points || 0, type: c.type || 'note', ordre: c.ordre || 0 }));
  return {
    all: map,
    blocA: map.filter((c) => c.bloc === 'A'),
    blocB: map.filter((c) => c.bloc === 'B'),
    bonus: map.filter((c) => c.bloc === 'bonus'),
    // Critères notés des blocs A/B (hors porte éliminatoire A6) — base de la notation + des écarts.
    notes: map.filter((c) => (c.bloc === 'A' || c.bloc === 'B') && c.type === 'note'),
    byCode: Object.fromEntries(map.map((c) => [c.code, c])),
  };
}

async function getParams(strapi) {
  const p = await strapi.documents('api::parametres-evaluation.parametres-evaluation').findFirst({});
  return {
    seuilBase: p?.seuilBase ?? 60,
    ecartPct: p?.ecartPct != null ? Number(p.ecartPct) : 0.2,
    bandes: Array.isArray(p?.bandes) && p.bandes.length ? p.bandes : DEFAULT_BANDES,
  };
}

function bandeFor(total, bandes) {
  const sorted = [...(bandes || DEFAULT_BANDES)].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (total >= b.min) return b.label;
  return sorted[sorted.length - 1]?.label || '';
}

// Somme des notes d'un bloc à partir d'un dictionnaire { code: note } (ou {code:{note}}).
function sumBloc(bareme, blocKey, byCode) {
  return bareme[blocKey].reduce((s, c) => {
    const v = byCode?.[c.code];
    const n = typeof v === 'object' ? Number(v?.note) : Number(v);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

// Totaux + bande à partir des notes retenues (bloc A/B) et du bonus (plafonné à 10).
function computeTotals(bareme, params, notesByCode, bonusByCode) {
  const totalA = sumBloc(bareme, 'blocA', notesByCode);
  const totalB = sumBloc(bareme, 'blocB', notesByCode);
  const bonusRaw = sumBloc(bareme, 'bonus', bonusByCode);
  const bonus = Math.min(10, bonusRaw);
  const totalHorsBonus = totalA + totalB;
  // Le bonus ne rattrape jamais le seuil de base : la bande se calcule sur le total HORS bonus.
  const totalFinal = Math.min(100, totalHorsBonus) + bonus;
  const bande = bandeFor(totalHorsBonus, params.bandes);
  return { totalA, totalB, bonus, totalHorsBonus, totalFinal, bande };
}

// Note d'un critère dans une fiche (notes JSON { code: { note, commentaire } }).
function noteOf(fiche, code) {
  const v = fiche?.notes?.[code];
  const n = typeof v === 'object' ? Number(v?.note) : Number(v);
  return Number.isFinite(n) ? n : null;
}
function bonusOf(fiche, code) {
  const v = fiche?.bonus?.[code];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Écarts significatifs (E4) entre deux fiches : |n1 - n2| >= points × ecartPct, sur les critères notés.
function detectEcarts(bareme, params, fiches) {
  const submitted = fiches.filter((f) => f && f.statut === 'soumise' && f.esConforme !== false);
  const ecarts = [];
  if (submitted.length < 2) return ecarts;
  const [f1, f2] = submitted;
  for (const c of bareme.notes) {
    const n1 = noteOf(f1, c.code);
    const n2 = noteOf(f2, c.code);
    if (n1 == null || n2 == null) continue;
    const seuil = c.points * params.ecartPct;
    const ecart = Math.abs(n1 - n2);
    if (ecart >= seuil && ecart > 0) ecarts.push({ code: c.code, libelle: c.libelle, n1, n2, ecart, seuil });
  }
  return ecarts;
}

// Recommandation pré-remplie depuis la bande (6.4 — sur le total HORS bonus).
// >=80 sélection · 70-79 conditionnelle · 60-69 liste d'attente · <60 rejet.
function recoFromScore(totalHorsBonus, params) {
  const seuil = params?.seuilBase ?? 60;
  if (totalHorsBonus >= 80) return 'selection';
  if (totalHorsBonus >= 70) return 'conditionnelle';
  if (totalHorsBonus >= seuil) return 'attente';
  return 'rejet';
}

module.exports = {
  DEFAULT_BANDES,
  getBareme,
  getParams,
  bandeFor,
  computeTotals,
  noteOf,
  bonusOf,
  detectEcarts,
  recoFromScore,
};

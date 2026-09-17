'use strict';

// Delais d'instruction exprimes en JOURS OUVRES.
//
// Pourquoi ce module : jusqu'ici l'instructeur saisissait une DATE d'echeance a la proposition,
// et cette date etait envoyee telle quelle au candidat le jour ou l'UGP validait. Chaque jour
// d'attente de validation etait donc pris sur le temps du candidat (une proposition du 17 avec
// echeance au 20, validee le 21, arrivait deja expiree). Le cabinet propose desormais une DUREE ;
// l'echeance se calcule au moment ou le candidat est reellement notifie, c'est-a-dire a la
// validation UGP.
//
// Fonctions PURES (aucun acces base, aucun `new Date()` cache hors de `aujourdHui`) : elles sont
// utilisees par le controleur, par le script de reprise des dossiers deja traites et par les tests.
//
// Fuseau : tout est calcule a Bujumbura (UTC+2, sans heure d'ete). Le serveur tourne en UTC ;
// sans cela, une validation faite en soiree locale serait datee de la veille ou du lendemain.

const FUSEAU = 'Africa/Bujumbura';

// Les jours feries burundais ne sont pas geres : ils ne sont pas dans le referentiel et une
// liste codee en dur vieillirait mal. Un ferie rallonge donc le delai reel du candidat, jamais
// l'inverse — c'est le sens qui protege.
function aujourdHui(maintenant = new Date()) {
  // en-CA rend « AAAA-MM-JJ », ce que Strapi attend pour un champ `date`.
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}

// Les dates-jours sont manipulees a midi UTC : aucun decalage de fuseau ne peut faire basculer
// le quantieme d'un jour a l'autre.
function versDate(jour) {
  const s = String(jour).slice(0, 10);
  const [a, m, j] = s.split('-').map(Number);
  if (!a || !m || !j) return null;
  return new Date(Date.UTC(a, m - 1, j, 12, 0, 0));
}

function versJour(date) {
  return date.toISOString().slice(0, 10);
}

// Lundi..vendredi (getUTCDay : 0 = dimanche, 6 = samedi).
function estJourOuvre(jour) {
  const d = versDate(jour);
  if (!d) return false;
  const n = d.getUTCDay();
  return n >= 1 && n <= 5;
}

// Echeance = `depart` + `nb` jours ouvres. Le jour de depart ne compte pas : un delai de
// 3 jours ouvres accorde a partir d'un mercredi tombe le lundi suivant.
function ajouterJoursOuvres(depart, nb) {
  const d = versDate(depart);
  if (!d) return null;
  let reste = Math.max(0, Math.floor(Number(nb) || 0));
  while (reste > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (estJourOuvre(versJour(d))) reste -= 1;
  }
  return versJour(d);
}

// Nombre de jours ouvres entre deux jours (depart exclu, fin incluse) — l'inverse exact de
// `ajouterJoursOuvres`. Sert a relire en jours ouvres les echeances saisies avant ce changement.
function compterJoursOuvres(depart, fin) {
  const a = versDate(depart);
  const b = versDate(fin);
  if (!a || !b || b <= a) return 0;
  let n = 0;
  const d = new Date(a.getTime());
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (estJourOuvre(versJour(d))) n += 1;
  }
  return n;
}

// Delai retenu : un entier, jamais sous le minimum du referentiel, avec repli sur le delai
// par defaut quand la valeur est absente ou illisible.
function normaliserDelai(valeur, { defaut, minimum }) {
  const n = Math.floor(Number(valeur));
  const parDefaut = Math.max(1, Math.floor(Number(defaut) || 3));
  const min = Math.max(1, Math.floor(Number(minimum) || 2));
  if (!Number.isFinite(n) || n <= 0) return Math.max(parDefaut, min);
  return Math.max(n, min);
}

module.exports = {
  FUSEAU,
  aujourdHui,
  estJourOuvre,
  ajouterJoursOuvres,
  compterJoursOuvres,
  normaliserDelai,
};

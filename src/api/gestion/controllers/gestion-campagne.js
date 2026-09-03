'use strict';

// Campagnes d'e-mails ponctuelles — porte d'entree HTTP du moteur de mail.
//
// POURQUOI CETTE ROUTE EXISTE
// Le moteur d'envoi (utils/mail/mail-service) est complet : gabarits, rendu, journal,
// transport. Mais il n'etait appelable que depuis l'interieur du CMS (lifecycles, cron,
// controleurs). Une campagne decidee a la main n'avait donc aucun point d'entree, et un
// script lance depuis un poste de travail ne peut pas aboutir : le relais SMTP n'accepte
// que les IP du serveur. Cette route est ce chainon manquant, et rien d'autre.
//
// POURQUOI `auth: false` ET UN SECRET, PLUTOT QUE LE ROLE UGP
// Les routes /gestion sont gardees par requireRole, qui lit ctx.state.user. Un appel
// machine (jeton API) ne peuple pas cet objet : il est rejete en 401 — verifie. Comme la
// campagne doit pouvoir etre declenchee sans session humaine, la garde est ici un secret
// dedie, sur le meme modele que REVALIDATE_SECRET pour le webhook du portail. Sa portee
// est UNE route : il ne lit aucun dossier, n'ecrit aucun referentiel.
// Secret absent => la route refuse tout (fermeture par defaut, jamais ouverture).
//
// LES QUATRE GARDE-FOUS, dans l'ordre ou ils s'appliquent
//  1. `envoyer` vaut faux par defaut : on simule, on rend le message, on n'envoie rien.
//  2. `mode: 'test'` (defaut) n'autorise QUE les adresses de test. Une adresse de vrai
//     candidat y est mecaniquement impossible — ce n'est pas une consigne, c'est un filtre.
//  3. En mode reel, les adresses de test sont exclues, et chaque domaine destinataire est
//     verifie en DNS : sans enregistrement MX, l'adresse ne peut pas recevoir. C'est ce qui
//     evite de re-tenter les adresses mortes saisies a l'inscription.
//  4. La cle de campagne dedoublonne : une adresse deja servie sous cette cle est ecartee.
//     Relancer une campagne interrompue reprend ou elle s'est arretee, sans doublon.

const dns = require('dns').promises;
const crypto = require('crypto');
const { sendRaw, resolveTemplate, renderTemplate, buildBaseContext, isEmailDeliveryConfigured } = require('../../../utils/mail/mail-service');

const UID_LOG = 'api::mail-log.mail-log';

// Les comptes de test. L'adresse NUE en fait partie : le motif « +% » seul la laisse
// passer, piege deja rencontre sur le script de purge.
const RE_TEST = /^endauhambo(\+[^@]*)?@gmail\.com$/i;

// Un domaine sosie a de VRAIS enregistrements MX — le controle DNS ne le voit donc pas
// passer. Ce sont des fautes de frappe qui atterrissent chez un squatteur : y envoyer les
// donnees d'un candidat serait une fuite, meme minuscule. Cas rencontre en production :
// une inscription du 20/08 saisie en « gmail.co » (un « m » manquant) — jamais joignable.
const DOMAINES_SOSIES = new Set([
  'gmail.co', 'gmail.cm', 'gmail.con', 'gmail.om', 'gmail.comm', 'gmaill.com',
  'gmial.com', 'gmai.com', 'gmail.fr.com', 'hotmail.co', 'hotmial.com',
  'yahoo.co', 'yahou.fr', 'outlook.co',
]);

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Un {{marqueur}} non resolu part tel quel dans le courrier. Devant un dirigeant
// d'entreprise, c'est l'erreur qui se voit — on refuse plutot que d'envoyer.
const RE_MARQUEUR_RESTANT = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/;
const RE_CLE = /^[a-z0-9][a-z0-9._-]{2,48}$/;

const LIMITE_DEFAUT = 50;
const LIMITE_MAX = 500;
const SEUIL_ARRIERE_PLAN = 25; // au-dela, on rend la main et on poursuit en fond
const PAUSE_MS = Number(process.env.CAMPAGNE_PAUSE_MS || 1200);

// Comparaison a duree constante : une egalite naive laisse deviner le secret caractere
// par caractere en mesurant le temps de reponse.
function secretValide(fourni) {
  const attendu = process.env.CAMPAGNE_SECRET;
  if (!attendu || !fourni) return false;
  const a = Buffer.from(String(attendu));
  const b = Buffer.from(String(fourni));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Un domaine sans MX ne peut recevoir aucun courrier : l'envoi echouerait de toute facon,
// mais en laissant une trace d'echec qui pollue le journal et abime la reputation du
// domaine expediteur. Mieux vaut ecarter avant. Cache par requete : une campagne vise
// souvent 200 adresses pour 5 domaines.
async function domaineAccepte(domaine, cache) {
  if (cache.has(domaine)) return cache.get(domaine);
  let ok = false;
  try {
    const mx = await dns.resolveMx(domaine);
    ok = Array.isArray(mx) && mx.length > 0;
  } catch (_) {
    ok = false;
  }
  cache.set(domaine, ok);
  return ok;
}

function normaliserDestinataires(brut) {
  const liste = Array.isArray(brut) ? brut : [];
  const vus = new Set();
  const sortie = [];
  for (const item of liste) {
    const email = String((typeof item === 'string' ? item : item?.email) || '').trim().toLowerCase();
    if (!email) continue;
    if (vus.has(email)) continue; // doublon dans la liste fournie
    vus.add(email);
    sortie.push({ email, payload: (typeof item === 'object' && item?.payload) || {} });
  }
  return sortie;
}

// Adresses deja servies sous cette cle. On interroge par lots : `$in` sur 500 chaines
// passe, mais autant rester sobre.
async function dejaServis(strapi, cle, emails) {
  const servis = new Set();
  for (let i = 0; i < emails.length; i += 100) {
    const lot = emails.slice(i, i + 100);
    const lignes = await strapi.db.query(UID_LOG).findMany({
      where: { cle, statut: 'envoye', destinataire: { $in: lot } },
      select: ['destinataire'],
    });
    for (const l of lignes) servis.add(String(l.destinataire).toLowerCase());
  }
  return servis;
}

// Rendu d'un message pour UN destinataire. Deux sources possibles : un gabarit du
// referentiel, ou un sujet/corps libres. Dans les deux cas on produit la meme forme, si
// bien que l'envoi et la simulation partagent exactement le meme code de rendu — ce qui
// est la seule facon pour qu'une simulation dise la verite.
async function rendre({ template, tpl, base, sujet, texte, html }, payload) {
  if (tpl) {
    const contexte = { ...base, ...payload };
    const rendu = renderTemplate(tpl, contexte);
    return { sujet: rendu.subject, texte: rendu.text, html: rendu.html };
  }
  const remplace = (s) =>
    String(s || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, cle) => {
      const v = cle.split('.').reduce((o, k) => (o == null ? undefined : o[k]), { ...base, ...payload });
      return v == null ? m : String(v);
    });
  return { sujet: remplace(sujet), texte: remplace(texte), html: html ? remplace(html) : undefined };
}

async function envoyerLot(strapi, { cle, retenus, contexteRendu, mode }) {
  let envoyes = 0;
  let echecs = 0;
  for (const destinataire of retenus) {
    const message = await rendre(contexteRendu, destinataire.payload);
    try {
      const r = await sendRaw({
        to: destinataire.email,
        subject: message.sujet,
        text: message.texte,
        html: message.html,
        key: cle,
        meta: { campagne: cle, mode },
      });
      if (r?.sent) envoyes += 1;
      else echecs += 1;
    } catch (error) {
      echecs += 1;
      strapi.log.warn(`[campagne ${cle}] echec ${destinataire.email} : ${error.message}`);
    }
    if (PAUSE_MS > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  strapi.log.info(`[campagne ${cle}] termine — ${envoyes} envoye(s), ${echecs} echec(s).`);
  return { envoyes, echecs };
}

module.exports = {
  async envoyer(ctx) {
    if (!process.env.CAMPAGNE_SECRET) {
      return ctx.serviceUnavailable('Campagnes non configurees sur ce serveur.');
    }
    const fourni = ctx.request.headers['x-campagne-secret'];
    if (!secretValide(fourni)) {
      return ctx.unauthorized('Secret de campagne invalide.');
    }

    const strapi = ctx.state?.strapi || global.strapi;
    const body = ctx.request.body || {};

    const cle = String(body.cle || body.id || '').trim().toLowerCase();
    if (!RE_CLE.test(cle)) {
      return ctx.badRequest('Cle de campagne invalide (3 a 49 caracteres : a-z, 0-9, . _ -).');
    }

    const mode = body.mode === 'reel' ? 'reel' : 'test';
    const envoyer = body.envoyer === true;
    const limite = Math.min(Number(body.limite) || LIMITE_DEFAUT, LIMITE_MAX);

    // --- Source du message ---------------------------------------------------------
    let tpl = null;
    if (body.template) {
      try {
        tpl = await resolveTemplate(String(body.template));
      } catch (error) {
        return ctx.badRequest(`Gabarit « ${body.template} » introuvable : ${error.message}`);
      }
    } else if (!body.sujet || !body.texte) {
      return ctx.badRequest('Fournir soit `template`, soit `sujet` ET `texte`.');
    }

    const base = { ...buildBaseContext(), ...(body.payload || {}) };
    const contexteRendu = { template: body.template || null, tpl, base, sujet: body.sujet, texte: body.texte, html: body.html };

    // --- Constitution de la cible ---------------------------------------------------
    const candidats = normaliserDestinataires(body.destinataires);
    if (candidats.length === 0) {
      return ctx.badRequest('Aucun destinataire fourni.');
    }

    const exclus = { malformee: [], horsModeTest: [], compteDeTest: [], domaineSosie: [], domaineInexistant: [], dejaServi: [] };
    const cacheDns = new Map();
    let retenus = [];

    for (const d of candidats) {
      if (!RE_EMAIL.test(d.email)) {
        exclus.malformee.push(d.email);
        continue;
      }
      const estTest = RE_TEST.test(d.email);
      // Le filtre central. En mode test, seules les adresses de test survivent : atteindre
      // un vrai candidat est impossible, pas seulement deconseille.
      if (mode === 'test' && !estTest) {
        exclus.horsModeTest.push(d.email);
        continue;
      }
      if (mode === 'reel' && estTest) {
        exclus.compteDeTest.push(d.email);
        continue;
      }
      const domaine = d.email.split('@')[1];
      if (DOMAINES_SOSIES.has(domaine)) {
        exclus.domaineSosie.push(d.email);
        continue;
      }
      if (!(await domaineAccepte(domaine, cacheDns))) {
        exclus.domaineInexistant.push(d.email);
        continue;
      }
      retenus.push(d);
    }

    const servis = await dejaServis(strapi, cle, retenus.map((d) => d.email));
    if (servis.size > 0) {
      exclus.dejaServi = retenus.filter((d) => servis.has(d.email)).map((d) => d.email);
      retenus = retenus.filter((d) => !servis.has(d.email));
    }

    const plafonne = retenus.length > limite;
    if (plafonne) retenus = retenus.slice(0, limite);

    // --- Apercu : le message reellement rendu pour le premier destinataire -----------
    const apercu = retenus.length > 0 ? await rendre(contexteRendu, retenus[0].payload) : null;

    const rapport = {
      cle,
      mode,
      envoyer,
      smtp: isEmailDeliveryConfigured() ? 'configure' : 'non configure',
      recus: candidats.length,
      retenus: retenus.length,
      plafonne,
      limite,
      exclus: Object.fromEntries(Object.entries(exclus).filter(([, v]) => v.length > 0)),
      destinataires: retenus.map((d) => d.email),
      apercu: apercu ? { sujet: apercu.sujet, texte: apercu.texte, html: apercu.html ? `${apercu.html.length} caracteres` : null } : null,
    };

    // Marqueurs non resolus : signales en simulation, bloquants a l'envoi. On teste sur le
    // rendu reel du premier destinataire, pas sur le gabarit — c'est le payload qui decide.
    const marqueursRestants = apercu && (RE_MARQUEUR_RESTANT.test(apercu.sujet || '') || RE_MARQUEUR_RESTANT.test(apercu.texte || ''));
    if (marqueursRestants) rapport.alerte = 'Des marqueurs {{...}} ne sont pas resolus : completer `payload`.';

    if (!envoyer) {
      ctx.body = { ...rapport, statut: 'simulation — aucun envoi' };
      return;
    }
    if (marqueursRestants) {
      return ctx.badRequest('Envoi refuse : des marqueurs {{...}} ne sont pas resolus.', { rapport });
    }
    if (retenus.length === 0) {
      ctx.body = { ...rapport, statut: 'aucun destinataire retenu — aucun envoi' };
      return;
    }

    // Au-dela du seuil, l'envoi depasse le delai d'attente d'une requete HTTP : on rend
    // la main immediatement et on poursuit en fond. Le suivi se lit dans le journal
    // (`mail_logs` filtre sur la cle), qui est la source de verite dans les deux cas.
    if (retenus.length > SEUIL_ARRIERE_PLAN) {
      setImmediate(() => {
        envoyerLot(strapi, { cle, retenus, contexteRendu, mode }).catch((error) =>
          strapi.log.error(`[campagne ${cle}] interrompue : ${error.message}`)
        );
      });
      ctx.body = { ...rapport, statut: `envoi en cours en arriere-plan (${retenus.length} destinataires)` };
      return;
    }

    const bilan = await envoyerLot(strapi, { cle, retenus, contexteRendu, mode });
    ctx.body = { ...rapport, statut: 'envoi termine', ...bilan };
  },
};

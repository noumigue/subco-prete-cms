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
const { buildPiecesBlocks } = require('../../../utils/mail/campagne-pieces');

const UID_LOG = 'api::mail-log.mail-log';
const UID_CANDIDATURE = 'api::candidature.candidature';

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

// --- Copie a l'equipe des experts ----------------------------------------------------
//
// Une campagne partie doit etre visible de l'equipe : c'est de la supervision, pas une
// notification de plus. La copie annonce donc le bilan CHIFFRE (dont les echecs : les
// cacher viderait la copie de son sens) puis reproduit le message tel que les candidats
// l'ont recu.
//
// LE PROBLEME DU SPECIMEN. Une campagne comme `relance_pieces` est personnalisee : son
// corps EST la liste des pieces manquantes d'un candidat precis. Copier le message rendu
// pour un vrai destinataire reviendrait a diffuser ses donnees a huit personnes qui ne
// sont pas lui. On rend donc le specimen a partir d'un COMPTE DE TEST, dont le dossier
// est reel mais n'appartient a personne.
// La garde est mecanique : une adresse de specimen qui n'est pas un compte de test est
// refusee. Il n'existe aucun chemin par lequel les donnees d'un vrai candidat entrent ici.

// La copie ne part QU'AU dernier envoi d'une campagne, et jamais en mode test.
//
// Deux raisons. D'abord le mode test promet qu'aucune personne reelle ne recoit rien :
// y laisser partir huit courriers viderait cette promesse. Ensuite le deroule impose
// (simulation -> essai -> lot de 30 -> verification -> le reste) comporte PLUSIEURS
// envois reels ; l'equipe ne doit etre servie qu'une fois, a la fin.
// Or seul un humain sait quel envoi est le dernier. On l'exige donc en clair — un
// `final: true` — plutot que de le deviner : oublier le drapeau ne fait rien partir,
// tandis qu'une regle implicite aurait servi l'equipe des le lot de 30.
function copieDemandee(body, mode, envoyer) {
  if (body.copieEquipe === false) return { active: false, motif: 'desactivee explicitement' };
  if (body.final !== true && body.copieEquipe?.final !== true) return { active: false, motif: 'envoi non marque `final: true`' };
  if (mode !== 'reel') return { active: false, motif: 'mode test — la copie ne part jamais en essai' };
  if (!envoyer) return { active: false, motif: 'simulation' };
  return { active: true, motif: null };
}

function listeCopieEquipe(body) {
  if (body.copieEquipe === false) return [];
  const brut = Array.isArray(body.copieEquipe?.destinataires)
    ? body.copieEquipe.destinataires
    : String(process.env.CAMPAGNE_COPIE_EQUIPE || '').split(',');
  return [...new Set(brut.map((e) => String(e || '').trim().toLowerCase()).filter((e) => RE_EMAIL.test(e)))];
}

// Reconstitue le payload d'un dossier reel de test : memes pieces manquantes, meme
// groupement, meme accord en nombre que ce qu'un candidat aurait recu.
async function construireSpecimen(strapi, email) {
  const dossiers = await strapi.documents(UID_CANDIDATURE).findMany({
    filters: { owner: { email: { $eqi: email } } },
    fields: ['documentId', 'numeroDossier', 'donneesProjet'],
    limit: 1,
  });
  const donnees = dossiers?.[0]?.donneesProjet;
  const pieces = Array.isArray(donnees?.pieces) ? donnees.pieces : [];
  const manquantes = pieces.filter((p) => !p?.depose);
  if (manquantes.length === 0) return null;
  const blocs = buildPiecesBlocks(manquantes);
  return {
    piecesTexte: blocs.piecesTexte,
    piecesHtml: blocs.piecesHtml,
    nbManquantesTexte: blocs.nbManquantesTexte,
    nbManquantes: blocs.nbManquantes,
    nbObligatoires: blocs.nbObligatoires,
  };
}

function enteteCopie({ cle, mode, bilan, nbCibles, cumul }) {
  const echecs = bilan.echecs > 0 ? `${bilan.echecs} echec(s)` : 'aucun echec';
  const l = [
    'COPIE INTERNE — equipe des experts SUBCO-PRETE',
    '',
    `Campagne   : ${cle}${mode === 'test' ? '  (mode test)' : ''}`,
    `Terminee   : ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Bujumbura' })}`,
    `Cet envoi  : ${nbCibles} candidat(s) vises — ${bilan.envoyes} envoye(s), ${echecs}`,
    ...(cumul && cumul.total > nbCibles
      ? [`Campagne   : ${cumul.envoyes} candidat(s) servi(s) au total${cumul.echecs ? `, ${cumul.echecs} en echec` : ''}`]
      : []),
    '',
    "Ci-dessous, le message tel que les candidats l'ont recu. L'exemple de pieces provient",
    "d'un compte de TEST, jamais d'un candidat reel.",
    '',
    '─────────────────────────────────────────────────────────────',
    '',
  ];
  return l.join('\n');
}

function enteteCopieHtml({ cle, mode, bilan, nbCibles, cumul }) {
  const echecs = bilan.echecs > 0 ? `<b style="color:#b45309">${bilan.echecs} echec(s)</b>` : 'aucun echec';
  return `<div style="margin:0 0 20px;padding:14px 16px;background:#f1f5f9;border-left:4px solid #334155;border-radius:6px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.7;color:#334155;">
      <div style="font-weight:700;letter-spacing:.4px;text-transform:uppercase;font-size:11px;margin-bottom:8px;">Copie interne — equipe des experts</div>
      <div><b>Campagne :</b> ${escapeHtmlSimple(cle)}${mode === 'test' ? ' (mode test)' : ''}</div>
      <div><b>Terminee :</b> ${escapeHtmlSimple(new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Bujumbura' }))}</div>
      <div><b>Cet envoi :</b> ${nbCibles} candidat(s) vises — ${bilan.envoyes} envoye(s), ${echecs}</div>
      ${cumul && cumul.total > nbCibles
        ? `<div><b>Campagne :</b> ${cumul.envoyes} candidat(s) servi(s) au total${cumul.echecs ? `, ${cumul.echecs} en echec` : ''}</div>`
        : ''}
      <div style="margin-top:10px;color:#64748b;">Ci-dessous, le message tel que les candidats l'ont recu. L'exemple de pieces provient d'un compte de test, jamais d'un candidat reel.</div>
    </div>`;
}

function escapeHtmlSimple(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Bilan CUMULE de la campagne, toutes vagues confondues. Une campagne se deroule en
// plusieurs envois (un lot d'essai, un lot de rodage, le solde) : annoncer le seul lot
// courant sous-declare ce qui a ete diffuse. Constate sur relance-pieces-2026-09-03, ou
// la copie annoncait 84 destinataires alors que 114 candidats avaient ete servis.
// Les lignes de la copie elle-meme portent la cle « <cle>:copie-equipe » : l'egalite
// stricte sur `cle` les laisse donc dehors, sans filtre supplementaire.
async function cumulCampagne(strapi, cle) {
  try {
    const lignes = await strapi.db.query(UID_LOG).findMany({
      where: { cle },
      select: ['destinataire', 'statut'],
      limit: 5000,
    });
    const envoyes = new Set();
    const echoues = new Set();
    for (const l of lignes) {
      const e = String(l.destinataire || '').toLowerCase();
      if (l.statut === 'envoye') envoyes.add(e);
      else echoues.add(e);
    }
    // Une adresse ayant echoue puis reussi ne compte que comme reussie.
    for (const e of envoyes) echoues.delete(e);
    return { envoyes: envoyes.size, echecs: echoues.size, total: envoyes.size + echoues.size };
  } catch (error) {
    strapi?.log?.warn(`[campagne] cumul indisponible pour « ${cle} » : ${error.message}`);
    return null;
  }
}

async function envoyerCopieEquipe(strapi, { cle, mode, contexteRendu, bilan, servis, copie, specimenPayload, nbCibles }) {
  // Personne ne recoit deux fois : les huit experts sont tous abonnes a l'annonce AMI et
  // peuvent donc figurer dans la cible d'une campagne. Celui qui a deja recu est retire.
  const destinataires = copie.filter((e) => !servis.has(e));
  if (destinataires.length === 0) return { copieEnvoyee: 0, copieIgnoree: 'tous deja destinataires de la campagne' };

  const message = await rendre(contexteRendu, specimenPayload || {});
  const cumul = await cumulCampagne(strapi, cle);
  const entete = { cle, mode, bilan, nbCibles, cumul };
  const texte = enteteCopie(entete) + (message.texte || '');
  const html = message.html ? enteteCopieHtml(entete) + message.html : undefined;
  const sujet = `[Copie interne] ${message.sujet}`;

  let envoyees = 0;
  for (const email of destinataires) {
    try {
      const r = await sendRaw({ to: email, subject: sujet, text: texte, html, key: `${cle}:copie-equipe`, meta: { campagne: cle, copieEquipe: true } });
      if (r?.sent) envoyees += 1;
    } catch (error) {
      strapi.log.warn(`[campagne ${cle}] copie equipe echouee pour ${email} : ${error.message}`);
    }
    if (PAUSE_MS > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  strapi.log.info(`[campagne ${cle}] copie equipe — ${envoyees}/${destinataires.length} envoyee(s).`);
  return { copieEnvoyee: envoyees, copieDestinataires: destinataires };
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

    // --- Copie a l'equipe : resolution et garde du specimen -------------------------
    const copieEtat = copieDemandee(body, mode, envoyer);
    const copie = copieEtat.active ? listeCopieEquipe(body) : [];
    const copiePrevue = listeCopieEquipe(body);
    const specimenEmail = String(body.copieEquipe?.specimen || process.env.CAMPAGNE_SPECIMEN || '').trim().toLowerCase();
    let specimenPayload = null;
    let specimenNote = null;
    if (copiePrevue.length > 0 && specimenEmail) {
      // LA garde : le specimen ne peut etre qu'un compte de test. Sans cela, la copie
      // diffuserait les pieces manquantes d'un vrai candidat a huit tiers.
      if (!RE_TEST.test(specimenEmail)) {
        return ctx.badRequest(`Specimen refuse : « ${specimenEmail} » n'est pas un compte de test. La copie a l'equipe ne peut pas reproduire les donnees d'un candidat reel.`);
      }
      try {
        specimenPayload = await construireSpecimen(strapi, specimenEmail);
        specimenNote = specimenPayload
          ? `specimen ${specimenEmail} — ${specimenPayload.nbManquantesTexte} manquante(s)`
          : `specimen ${specimenEmail} : aucune piece manquante, la copie utilisera le payload de la campagne`;
      } catch (error) {
        specimenNote = `specimen indisponible (${error.message})`;
      }
    }

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
      copieEquipe: copieEtat.active
        ? { partira: true, destinataires: copie, specimen: specimenNote }
        : { partira: false, motif: copieEtat.motif, destinatairesConfigures: copiePrevue.length, specimen: specimenNote },
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
      const servisFond = new Set(retenus.map((d) => d.email));
      setImmediate(() => {
        envoyerLot(strapi, { cle, retenus, contexteRendu, mode })
          .then((bilanFond) =>
            copie.length > 0
              ? envoyerCopieEquipe(strapi, { cle, mode, contexteRendu, bilan: bilanFond, servis: servisFond, copie, specimenPayload, nbCibles: retenus.length })
              : null
          )
          .catch((error) => strapi.log.error(`[campagne ${cle}] interrompue : ${error.message}`));
      });
      ctx.body = { ...rapport, statut: `envoi en cours en arriere-plan (${retenus.length} destinataires)` };
      return;
    }

    const bilan = await envoyerLot(strapi, { cle, retenus, contexteRendu, mode });
    const servisCampagne = new Set(retenus.map((d) => d.email));
    const copieBilan = copie.length > 0
      ? await envoyerCopieEquipe(strapi, { cle, mode, contexteRendu, bilan, servis: servisCampagne, copie, specimenPayload, nbCibles: retenus.length })
      : {};
    ctx.body = { ...rapport, statut: 'envoi termine', ...bilan, ...copieBilan };
  },
};

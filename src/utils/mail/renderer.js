'use strict';

// Moteur de rendu minimal et SANS dependance pour la « mail platform » SUBCO-PRETE.
//
// Pourquoi pas Handlebars ? Choix pragmatique (cf. docs/mail-platform.md) :
//  - les templates metier sont simples (interpolation + quelques conditions) ;
//  - zero dependance nouvelle a installer/auditer en prod ;
//  - rendu sur-mesure => on maitrise l'echappement HTML (anti-injection) et on peut
//    EXTRAIRE la liste des placeholders pour valider un template edite au CMS.
// La surface est volontairement reduite ; si un besoin d'expressions riches apparait,
// la bascule vers Handlebars se fait derriere cette meme interface (render / extractVariables).
//
// Syntaxe supportee :
//   {{ chemin.pointe }}     -> valeur echappee HTML
//   {{{ chemin.pointe }}}   -> valeur brute (a n'utiliser que pour du HTML de confiance)
//   {{#if chemin}} ... {{else}} ... {{/if}}
//   {{#unless chemin}} ... {{/unless}}
// Les blocs peuvent etre imbriques. Toute variable absente rend une chaine vide (fallback sur).

const HTML_ESCAPE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE[char]);
}

// Resout un chemin pointe ("call.title") dans le contexte, sans jamais lever.
function resolvePath(context, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, context);
}

function isTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

// --- Traitement des blocs conditionnels (recursif, imbrication supportee) -------------
// On repere le premier {{#if}} / {{#unless}}, on trouve son {{/...}} en equilibrant les
// ouvertures imbriquees, on evalue, puis on relance le rendu sur le fragment retenu.
const BLOCK_OPEN_RE = /\{\{\s*#(if|unless)\s+([\w.]+)\s*\}\}/;

function renderBlocks(template, context) {
  const match = BLOCK_OPEN_RE.exec(template);
  if (!match) return template;

  const [openTag, type, path] = match;
  const openStart = match.index;
  const innerStart = openStart + openTag.length;

  // Recherche du {{/type}} correspondant en tenant compte des blocs imbriques du meme type.
  const scanner = new RegExp(`\\{\\{\\s*(#(?:if|unless)\\s+[\\w.]+|/(?:if|unless))\\s*\\}\\}`, 'g');
  scanner.lastIndex = innerStart;
  let depth = 1;
  let closeStart = -1;
  let closeEnd = -1;
  let token;
  while ((token = scanner.exec(template)) !== null) {
    const raw = token[1];
    if (raw.startsWith('#')) {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        closeStart = token.index;
        closeEnd = scanner.lastIndex;
        break;
      }
    }
  }

  // Bloc non ferme : on neutralise l'ouverture et on continue (fallback sur, pas de crash).
  if (closeStart === -1) {
    return template.slice(0, openStart) + template.slice(innerStart);
  }

  const before = template.slice(0, openStart);
  const body = template.slice(innerStart, closeStart);
  const after = template.slice(closeEnd);

  // Separation optionnelle {{else}} au niveau racine de CE bloc.
  let truthyPart = body;
  let falsyPart = '';
  const elseMatch = findTopLevelElse(body);
  if (elseMatch !== -1) {
    truthyPart = body.slice(0, elseMatch.start);
    falsyPart = body.slice(elseMatch.end);
  }

  const value = resolvePath(context, path);
  const condition = type === 'unless' ? !isTruthy(value) : isTruthy(value);
  const chosen = condition ? truthyPart : falsyPart;

  // Rendu recursif : le fragment retenu, puis le reste du template.
  return before + renderBlocks(chosen, context) + renderBlocks(after, context);
}

// Trouve un {{else}} appartenant au bloc courant (profondeur 0), en ignorant les else imbriques.
function findTopLevelElse(body) {
  const scanner = /\{\{\s*(#(?:if|unless)\s+[\w.]+|\/(?:if|unless)|else)\s*\}\}/g;
  let depth = 0;
  let token;
  while ((token = scanner.exec(body)) !== null) {
    const raw = token[1];
    if (raw.startsWith('#')) depth += 1;
    else if (raw.startsWith('/')) depth -= 1;
    else if (raw === 'else' && depth === 0) {
      return { start: token.index, end: scanner.lastIndex };
    }
  }
  return -1;
}

// --- Interpolation des variables ------------------------------------------------------
// escape=true (HTML) : {{var}} echappe, {{{var}}} brut.
// escape=false (texte brut) : {{var}} et {{{var}}} rendus tels quels (pas d'entites HTML
//   dans un corps text/plain — sinon les URL contiennent &amp; et les noms &lt;).
function renderVariables(template, context, escape) {
  // {{{ raw }}} d'abord (pour ne pas etre capture par la regex echappee).
  let out = template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, path) => {
    const value = resolvePath(context, path);
    return value == null ? '' : String(value);
  });
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const value = resolvePath(context, path);
    if (value == null) return '';
    return escape ? escapeHtml(value) : String(value);
  });
  return out;
}

/**
 * Rend un template avec le contexte fourni. Ne leve jamais : une variable ou un bloc
 * mal forme retombe sur une chaine vide (fallback sur, exigence « garde-fou »).
 * @param {object} [options] { escape=true } ; passer escape:false pour un corps text/plain.
 */
function render(template, context = {}, options = {}) {
  if (typeof template !== 'string' || template.length === 0) return '';
  const escape = options.escape !== false;
  const withBlocks = renderBlocks(template, context);
  return renderVariables(withBlocks, context, escape);
}

/**
 * Extrait la liste (dedupliquee) des placeholders racine references par un template :
 * variables {{x}}, {{{x}}} ET conditions {{#if x}}/{{#unless x}}. Sert a valider
 * qu'un template edite au CMS n'introduit pas de variable inconnue et que le payload
 * fournit bien les variables requises.
 */
function extractVariables(template) {
  if (typeof template !== 'string') return [];
  const found = new Set();
  const varRe = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
  const blockRe = /\{\{\s*#(?:if|unless)\s+([\w.]+)\s*\}\}/g;
  let m;
  while ((m = varRe.exec(template)) !== null) {
    if (m[1] !== 'else') found.add(m[1].split('.')[0]);
  }
  while ((m = blockRe.exec(template)) !== null) {
    found.add(m[1].split('.')[0]);
  }
  return [...found];
}

module.exports = { render, extractVariables, escapeHtml, resolvePath };

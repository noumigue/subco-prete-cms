'use strict';

// Historique des versions deposees d'un dossier. Aucune route n'est ouverte au portail :
// le candidat lit ses depots via le `populate` de SA candidature (controleur owner-scope),
// l'equipe via l'API `gestion`. Le controleur core n'existe que pour completer l'API.
const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::depot-dossier.depot-dossier');

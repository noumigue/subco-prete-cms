'use strict';

// Données de la chaîne de valeur « Élevage porcin » (filière porcine).
// Calquée sur la structure des autres chaînes (volaille : intro, maillons, contraintes,
// opportunités, infrastructures possibles, modèle économique, alignement PRETE, impacts,
// risques). Contenu = blocks Strapi (paragraph / heading / list).

const p = (text) => ({ type: 'paragraph', children: [{ type: 'text', text }] });
const h = (level, text) => ({ type: 'heading', level, children: [{ type: 'text', text }] });
const ul = (items) => ({
  type: 'list',
  format: 'unordered',
  children: items.map((t) => ({ type: 'list-item', children: [{ type: 'text', text: t }] })),
});

const fullContent = [
  p("La chaîne de valeur porcine présente un potentiel réel pour la sécurité alimentaire, la nutrition, la création d'emplois et l'entrepreneuriat des jeunes et des femmes. Elle couvre la génétique et la reproduction, l'alimentation animale, l'engraissement, les services vétérinaires, l'abattage, la découpe, la transformation (charcuterie), la conservation par le froid et la distribution vers les marchés urbains, l'hôtellerie et la restauration."),

  h(2, 'Maillons à mettre en avant'),
  ul([
    "production locale d'aliments pour porcs (provende) ;",
    'fourniture de porcelets de qualité et amélioration génétique ;',
    'services vétérinaires, biosécurité et prévention de la peste porcine africaine (PPA) ;',
    'accompagnement technique des éleveurs et conduite d’élevage ;',
    'engraissement en bâtiments améliorés ;',
    'abattage conforme et hygiénique ;',
    'découpe, transformation et charcuterie (produits salaisonnés, saucisses) ;',
    'conservation par le froid et transport frigorifique ;',
    "valorisation des sous-produits (lisier, compost, biogaz) ;",
    'distribution vers marchés urbains, hôtels, restaurants et commerces modernes.',
  ]),

  h(2, 'Contraintes spécifiques'),
  p("Le coût élevé et la qualité irrégulière des aliments constituent la principale contrainte économique : l'alimentation représente l'essentiel du coût de production. L'accès à des porcelets de bonne génétique reste limité et la dépendance aux importations est fréquente."),
  p("La peste porcine africaine (PPA) est le risque sanitaire majeur : en l'absence de biosécurité rigoureuse, elle peut anéantir un cheptel. Les services vétérinaires spécialisés sont insuffisants, l'abattage demeure souvent informel et la chaîne du froid est peu développée, ce qui limite l'accès aux marchés formels et la valorisation de la viande."),

  h(2, 'Opportunités économiques'),
  p("La demande en protéines animales augmente avec l'urbanisation, la restauration et la consommation des ménages. Une filière structurée peut réduire les importations de viande et de charcuterie et fixer davantage de valeur localement."),
  p("La transformation (charcuterie, salaisons) et la conservation par le froid ouvrent des débouchés à plus forte marge. La valorisation des sous-produits (lisier en compost ou en biogaz) crée des revenus complémentaires et améliore la durabilité environnementale."),

  h(2, 'Infrastructures productives possibles'),
  p('Cette liste est indicative et non exhaustive.'),

  h(3, "Unité de production d'aliments pour porcs"),
  p("Rôle : produire localement une provende de qualité, formulée selon les stades physiologiques (porcelet, engraissement, reproduction)."),
  p('Besoins adressés : coût élevé des aliments, qualité irrégulière, dépendance externe, faible maîtrise des formulations.'),
  p('Équipements possibles : broyeur, mélangeur, granulateur, ensacheuse, balance, petit laboratoire de contrôle qualité.'),
  p('Bénéficiaires : éleveurs porcins, coopératives, jeunes entrepreneurs, femmes entrepreneures.'),
  p('Photo suggérée : sacs de provende, mélangeur, matières premières, opérateur contrôlant la fabrication.'),

  h(3, 'Ferme naisseur ou centre de multiplication génétique'),
  p('Rôle : garantir un approvisionnement régulier en porcelets sains et de bonne génétique.'),
  p('Besoins adressés : porcelets de mauvaise qualité, faible productivité des truies, consanguinité, dépendance externe.'),
  p('Services possibles : reproduction, insémination, sevrage, sélection, vente de porcelets, appui technique.'),
  p('Conditions critiques : biosécurité stricte, bâtiments adaptés, alimentation maîtrisée, compétences techniques.'),
  p("Photo suggérée : maternité porcine propre, truies et porcelets, technicien en tenue d'hygiène."),

  h(3, 'Centre de services vétérinaires et de biosécurité'),
  p('Rôle : fournir un ensemble de services techniques et sanitaires aux éleveurs et prévenir les épizooties.'),
  p('Services possibles : vaccination, suivi sanitaire, conseil en biosécurité, formation, approvisionnement en intrants vétérinaires.'),
  p('Besoins adressés : faibles capacités techniques, risque de PPA, mauvaise conduite d’élevage, mortalité.'),
  p('Photo suggérée : technicien formant des éleveurs, pédiluve et mesures de biosécurité à l’entrée d’une ferme.'),

  h(3, 'Abattoir porcin semi-moderne'),
  p('Rôle : améliorer la qualité sanitaire et commerciale de la viande porcine.'),
  p('Services possibles : abattage, échaudage, éviscération, inspection sanitaire, découpe, conditionnement.'),
  p('Besoins adressés : abattage informel, accès limité aux hôtels, restaurants et supermarchés, risques sanitaires.'),
  p('Conditions de viabilité : volumes réguliers, contrats avec éleveurs, chaîne du froid, personnel qualifié.'),
  p('Photo suggérée : ligne d’abattage propre, opérateurs équipés, zone de conditionnement.'),

  h(3, 'Unité de découpe, transformation et charcuterie'),
  p('Rôle : augmenter la valeur commerciale par des produits transformés et des formats adaptés aux consommateurs et acheteurs.'),
  p('Produits possibles : viande découpée conditionnée, saucisses, salaisons, produits fumés, préparations prêtes à cuisiner.'),
  p('Photo suggérée : atelier de découpe et de charcuterie, barquettes étiquetées, emballage alimentaire.'),

  h(3, 'Chambre froide pour produits porcins'),
  p('Rôle : conserver la viande fraîche, découpée ou transformée.'),
  p('Besoins adressés : pertes sanitaires, ventes rapides à faible marge, impossibilité de servir les marchés formels.'),
  p('Localisation possible : abattoir, marché de gros, distributeur, hub logistique ou zone urbaine.'),
  p('Photo suggérée : produits porcins conditionnés en chambre froide ou vitrine professionnelle.'),

  h(3, 'Transport frigorifique'),
  p('Rôle : relier les zones d’abattage et de transformation aux marchés en préservant la chaîne du froid.'),
  p('Besoins adressés : rupture du froid, limitation géographique des ventes, non-respect des normes sanitaires.'),
  p('Options : véhicules frigorifiques, caisses isothermes, suivi de température, circuits programmés.'),
  p('Photo suggérée : véhicule frigorifique chargé de produits conditionnés.'),

  h(3, 'Unité de valorisation des sous-produits (lisier, compost, biogaz)'),
  p('Rôle : transformer les effluents d’élevage en ressources et réduire l’impact environnemental.'),
  p('Besoins adressés : gestion des déchets, nuisances, coûts d’énergie et d’intrants agricoles.'),
  p('Options : unité de compostage, digesteur à biogaz, stockage et épandage maîtrisés du lisier.'),
  p('Photo suggérée : digesteur à biogaz ou aire de compostage attenante à la ferme.'),

  h(2, 'Modèle économique pertinent'),
  p("Le modèle le plus structurant est un modèle intégré intrants-production-marché : provende, génétique (porcelets), engraissement, abattage, transformation et distribution reliés par des contrats et la chaîne du froid."),
  p("Les revenus peuvent provenir de la vente de provende, de porcelets, de services vétérinaires, de viande fraîche, de produits de charcuterie et de la valorisation des sous-produits."),

  h(2, 'Alignement spécifique avec PRETE'),
  p("La subvention peut soutenir les unités d'aliments, fermes naisseurs, centres de services vétérinaires, abattoirs, chambres froides, unités de découpe et de charcuterie, transport frigorifique et valorisation des sous-produits."),
  p("Le projet doit présenter un apport privé, un business plan viable, une preuve de demande, un dispositif de biosécurité crédible et une gestion environnementale et sociale adaptée."),

  h(2, 'Impacts attendus'),
  ul([
    'baisse du coût des intrants ;',
    'amélioration de la productivité et de la génétique ;',
    'réduction de la mortalité et des pertes sanitaires ;',
    'meilleure qualité sanitaire de la viande ;',
    'accès aux marchés formels et à la restauration ;',
    'création d’emplois dans l’élevage, les intrants, l’abattage, la découpe, la charcuterie, le froid et la distribution ;',
    'opportunités pour les jeunes et les femmes ;',
    'meilleure sécurité alimentaire et nutrition ;',
    'valorisation des sous-produits et gestion améliorée des effluents.',
  ]),

  h(2, 'Risques à surveiller'),
  ul([
    'peste porcine africaine (PPA) et autres maladies ;',
    'défaillance de biosécurité ;',
    'coût élevé ou qualité faible des aliments ;',
    'porcelets de mauvaise génétique ;',
    'sous-utilisation de l’abattoir ou de la transformation ;',
    'rupture de la chaîne du froid ;',
    'marché informel dominant ;',
    'mauvaise gestion des effluents et nuisances environnementales.',
  ]),
];

module.exports = {
  name: 'Élevage porcin',
  slug: 'porcine',
  photoHint: "élevage porcin propre en bâtiment amélioré, maternité, atelier de charcuterie ou abattoir semi-moderne avec opérateurs en tenue d'hygiène.",
  shortIntro: "Soutenir les maillons critiques de génétique, alimentation, engraissement, abattage, transformation et commercialisation de la filière porcine.",
  isFeaturedHome: true,
  priorityOrder: 6, // juste avant « Projet transversal » (qui passe à 7)
  fullContent,
};

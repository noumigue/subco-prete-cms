# Strapi CMS PRETE

## Lancement

```bash
npm run develop
```

## Migration des chaînes de valeur

Une migration applicative est prévue pour exporter les `value-chains` locales avec leur image principale, puis les réimporter sur un autre Strapi via API.

### 1. Export local

Le script lit la base locale PostgreSQL et copie les images originales depuis `public/uploads/`.

```bash
npm run export:value-chains
```

Sortie par défaut :

```text
exports/value-chains/manifest.json
exports/value-chains/assets/*
```

Pour n’exporter qu’une entrée :

```bash
npm run export:value-chains -- --slug projet-transversal
```

### 2. Import sur le Strapi cible

Variables requises :

```bash
export TARGET_STRAPI_URL="https://cms.subco-prete.bi"
export TARGET_STRAPI_TOKEN="..."
```

Puis :

```bash
npm run import:value-chains
```

Le script :
- charge le manifeste exporté ;
- upload l’image si elle n’existe pas déjà sur le Strapi cible ;
- crée ou met à jour chaque `value-chain` par `slug` ;
- republie automatiquement l’entrée si elle était publiée à la source.

Pour un répertoire d’export spécifique :

```bash
npm run import:value-chains -- --in-dir /chemin/vers/export
```

### Notes

- Le flux suit la logique Strapi 5 : upload du média d’abord, création ou mise à jour de l’entrée ensuite.
- Les exports générés dans `exports/` sont ignorés par Git.

## Étapes du programme

La collection `etape-programme` alimente la bande `Prochaines étapes` sur la page d'accueil.

### Peuplement local

```bash
npm run populate:program-steps
```

### Règle métier importante

- Une seule étape par cohorte doit avoir le statut `en-cours` à un instant donné.
- Cette contrainte n'est pas automatiquement enforced par Strapi : l'équipe éditoriale doit la respecter dans l'admin.

### Usage éditorial

- Pour faire avancer le calendrier, il suffit de modifier le champ `statut`.
- Pour ajouter une nouvelle étape, créer un enregistrement avec la bonne `cohorte` et le bon `ordre`.
- Pour faire apparaître une nouvelle cohorte, ajouter des étapes avec une nouvelle valeur existante de cohorte, par exemple `cohorte-3`.

# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>

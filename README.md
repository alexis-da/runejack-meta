# Runejack Méta

Une app « à la metatft » pour [Runejack](https://play.runejack.com). Elle montre la tier list des compos, les héros, les objets, les runes, les bénédictions, la stratégie d’une run, les contres et le Contrebandier.

Les chiffres viennent du **simulateur officiel du banc d’essai** du jeu (`play.runejack.com/banc`), exécuté tel quel. L’app est régénérée automatiquement à chaque nouvelle version du jeu.

## Comment ça marche

1. `pipeline/fetch.mjs` lit la version du jeu dans les notes de patch, puis télécharge le moteur de simulation du banc (`sim.worker-*.js`).
2. `pipeline/banc.mjs` charge ce moteur en Node, sans le modifier. Il retrouve ses tables de données par motifs de contenu, parce que les noms de variables changent à chaque build.
3. `pipeline/analyze.mjs` lance toutes les mesures, en parallèle sur tous les cœurs :
   - le meilleur kit d’objets de chaque héros, seul à table ;
   - une recherche génétique puis une recherche locale des compos, et la même recherche sans le héros pivot de la meilleure compo ;
   - l’évaluation finale : médiane, P10-P90, boss battu par étage, milieu et fin de run, les 24 boss ;
   - les améliorations par le Contrebandier, les runes (build de 6 sans rune secrète) et les bénédictions ;
   - les débuts de partie (héros de coût 1-2 sans objet).
4. `pipeline/api.mjs` lit les statistiques des vraies parties sur l’API du jeu, si une clé est disponible.
5. `pipeline/update.mjs` enchaîne tout si la version a changé, puis écrit `data/meta.json` et `app/data.json`.

**Réglages des mesures** : ceux du banc par défaut.
- pacte du Joueur ;
- bot du jeu, sans contrat ;
- fin de run : 40 or, 22 salles gagnées ; milieu de run : 25 or, 10 salles ;
- étoiles réalistes : 1★ pour les héros de coût 4-5, 2★ sinon.

Les objets du Contrebandier n’entrent jamais dans les compos. Ils sont proposés comme améliorations quand il passe.

## Lancer

```bash
npm run update                # analyse seulement si la version du jeu a changé
npm run analyze               # force une nouvelle analyse
SCALE=0.2 npm run analyze     # analyse rapide (test)
npx serve app                 # ouvrir l’app en local (elle lit app/data.json)
```

Node 22 ou plus, sans dépendance. Derrière un proxy, `NODE_USE_ENV_PROXY=1` est déjà dans les scripts npm.

## Statistiques des vraies parties (facultatif)

1. Crée une clé sur `play.runejack.com/admin`, onglet **Clés API**.
2. Donne-la à la mise à jour sans jamais l’écrire dans le dépôt :
   - soit comme secret réseau de l’environnement cloud (en-tête `Authorization: Bearer <clé>` pour `play.runejack.com`) ;
   - soit comme variable d’environnement `RUNEJACK_API_KEY`.

Sans clé, l’onglet « Vraies parties » reste vide et tout le reste fonctionne. Avec une clé, ces statistiques sont rafraîchies à chaque passage de la tâche planifiée, même sans nouveau patch.

## Mise à jour automatique

Une tâche planifiée Claude Code tourne toutes les 6 heures. Ses consignes sont dans [`ROUTINE.md`](ROUTINE.md).

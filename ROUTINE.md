# Mise à jour automatique (tâche planifiée)

Consignes suivies par la tâche planifiée Claude Code, qui se déclenche toutes les 6 heures dans une session cloud neuve.

1. **Rattacher et cloner le dépôt** : `alexis-da/runejack-meta`, accès en écriture, dans `/home/user/runejack-meta`.
2. **Vérifier et analyser** : depuis ce dossier, lancer `npm run update`.
   - Code de sortie **0** : une nouvelle version a été analysée (environ 45 minutes, les données sont dans `data/meta.json` et `app/data.json`).
   - Code de sortie **11** : même version, mais les statistiques des vraies parties ont été rafraîchies dans `app/data.json`. Faire les étapes 3 et 4 (message de commit `Stats des vraies parties <date>`).
   - Code de sortie **10** : rien de neuf (même version, API indisponible). Terminer en une ligne.
   - Autre code : l’analyse a échoué. Ne rien publier, ne rien pousser, et résumer l’erreur. En général, un motif de `pipeline/banc.mjs` ne trouve plus une table du jeu.
3. **Enregistrer** (codes 0 et 11) :
   - commit de `data/meta.json` et `app/data.json` sur `main`, message `Méta <version>` (code 0) ;
   - push avec `git push -u origin main`.
4. **Publier l’app** (codes 0 et 11) avec l’outil Artifact :
   - `url` = `https://claude.ai/artifact/LS6A1aBxFyEwKRiF56aR8M` ;
   - `file_path` = `app/index.html` ;
   - `files` = `{"data.json": "app/data.json"}` ;
   - `label` = `Méta <version>` ;
   - lire d’abord l’artifact (`action: "read"`) si l’outil le demande.
5. **Résumer en quelques lignes** : la version, la meilleure compo (nom, médiane par salle, boss final battu) et ce qui a changé depuis la version précédente (champ `changes` de `data/meta.json`).

Ne jamais modifier le code de `pipeline/` ou de `app/` pendant une mise à jour automatique.

# Mise à jour automatique

## GitHub Actions : les données et le site

Le workflow [`.github/workflows/update.yml`](.github/workflows/update.yml) tourne toutes les 6 heures sur GitHub :

1. `npm test`, puis `node pipeline/update.mjs` :
   - code **0** : une nouvelle version du jeu a été analysée (environ 45 minutes) ;
   - code **11** : même version, mais les statistiques des vraies parties ont été rafraîchies ;
   - code **10** : rien de neuf ;
   - autre code : l’analyse a échoué, le workflow s’arrête en erreur et GitHub envoie un e-mail. En général, un motif de `pipeline/banc.mjs` ne trouve plus une table du jeu.
2. Pour les codes 0 et 11, commit de `data/meta.json` et `app/data.json` sur `main` (`Méta <version>` ou `Stats des vraies parties <date>`).
3. Vercel voit le push et redéploie le site.

La clé de l’API du jeu est le secret `RUNEJACK_API_KEY` du dépôt (Settings → Secrets and variables → Actions). Sans elle, l’analyse marche quand même, et les dernières statistiques des vraies parties sont gardées.

Lancer à la main : onglet **Actions** du dépôt → « Mise à jour de la méta » → **Run workflow**. Cocher la case pour forcer une analyse complète.

## Tâche planifiée Claude : l’app Claude

Une tâche planifiée Claude Code republie l’app Claude quand les données du dépôt ont changé. Elle ne calcule rien et ne pousse rien.

1. Cloner `https://github.com/alexis-da/runejack-meta` dans `/home/user/runejack-meta` (lecture seule suffit).
2. Lire `data.json` publié : outil Artifact, `action: "read"`, `url` = `https://claude.ai/artifact/LS6A1aBxFyEwKRiF56aR8M`, `path` = `data.json`.
3. Si `meta.generatedAt` et `stats.fetchedAt` sont les mêmes que dans `app/data.json` du dépôt, terminer en une ligne : « déjà à jour ».
4. Sinon, republier avec l’outil Artifact : même `url`, `file_path` = `app/index.html`, `files` = `{"data.json": "app/data.json"}`, `label` = `Méta <version>`.
5. Résumer en 2 ou 3 lignes : la version, la meilleure compo et son carry.

Ne jamais modifier le dépôt pendant ce passage.

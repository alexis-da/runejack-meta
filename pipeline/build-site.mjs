// Builds the static site for hosting outside Claude (Vercel, Netlify, any static host):
// public/index.html = app/index.html wrapped in a full HTML document, public/data.json = app/data.json.
// app/index.html stays a fragment because the Claude artifact publisher adds the document skeleton itself.
import fs from 'node:fs';

const page = fs.readFileSync('app/index.html', 'utf8');
const head = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Méta Runejack : tier list des compos, héros, objets, runes, bénédictions et stratégie, mesurés avec le simulateur du banc d’essai du jeu et mis à jour à chaque patch.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%2313241e'/%3E%3Ctext x='32' y='46' font-size='40' text-anchor='middle' fill='%23e8b84f' font-family='monospace'%3ER%3C/text%3E%3C/svg%3E">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
`;
// keep <title>, <meta>, <link> and <style> of the fragment in <head>, the rest in <body>
const split = page.indexOf('</style>') + '</style>'.length;
const html = `${head}${page.slice(0, split)}\n</head>\n<body>\n${page.slice(split)}\n</body>\n</html>\n`;
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/index.html', html);
if (!fs.existsSync('app/data.json')) throw new Error('app/data.json manquant : lancer `npm run update` d’abord');
fs.copyFileSync('app/data.json', 'public/data.json');
console.log(`public/ prêt (${(fs.statSync('public/data.json').size / 1024).toFixed(0)} Ko de données)`);

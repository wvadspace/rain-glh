#!/usr/bin/env node
/*
 * Bundles the game into one self-contained HTML file that runs from a
 * file:// URL, an email attachment, or any static host.
 *
 *   node build.js            -> dist/torque-and-turnover.html
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('styles.css');
const js = ['js/data.js', 'js/engine.js', 'js/ui.js'].map(read).join('\n');

const FONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700' +
  '&amp;family=Barlow:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;600&amp;display=swap">';

/*
 * Artifact mode emits the same game without the document wrapper, for hosts
 * that supply their own <head> and <body>.
 */
const artifactMode = process.argv.indexOf('--artifact') >= 0;
if (artifactMode) {
  const page = `<title>Torque &amp; Turnover</title>
${FONTS}
<style>
${css}
</style>
<div class="app">
  <header class="top" id="header"></header>
  <div class="main">
    <div id="body"></div>
    <div id="rail"></div>
  </div>
</div>
<div id="modal" style="display:none"></div>
<div id="toast" class="toast" style="display:none"></div>
<script>
${js}
window.AutoShopUI.boot();
</script>
`;
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const dest = path.join(root, 'dist', 'artifact.html');
  fs.writeFileSync(dest, page);
  console.log('Wrote ' + dest + ' (' + (page.length / 1024).toFixed(1) + ' KB)');
  process.exit(0);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Torque &amp; Turnover — Auto Shop Simulator</title>
${FONTS}
<meta name="description" content="A management simulator for an independent auto repair shop: bays, tooling, technicians, service advisors, parts inventory, pricing and advertising.">
<style>
${css}
</style>
</head>
<body>
<div class="app">
  <header class="top" id="header"></header>
  <div class="main">
    <div id="body"></div>
    <div id="rail"></div>
  </div>
</div>
<div id="modal" style="display:none"></div>
<div id="toast" class="toast" style="display:none"></div>
<script>
${js}
window.AutoShopUI.boot();
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'torque-and-turnover.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + out + ' (' + (html.length / 1024).toFixed(1) + ' KB)');

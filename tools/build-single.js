/*
 * Bundles the game into one self-contained HTML file.
 *
 *   node tools/build-single.js              -> dist/shop-floor.html (full document)
 *   node tools/build-single.js --fragment   -> dist/shop-floor.fragment.html
 *
 * The fragment form omits <!doctype>, <html>, <head> and <body> for hosts that
 * supply their own document shell.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const SCRIPTS = ['js/rng.js', 'js/data.js', 'js/state.js', 'js/sim.js',
  'js/actions.js', 'js/ui.js', 'js/main.js'];

const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700' +
  '&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';

const TITLE = 'Shop Floor';
const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<text y='26' font-size='26'>🔧</text></svg>";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* A closing </script> anywhere in the source would end the inline block early. */
const guard = (js) => js.replace(/<\/script/gi, '<\\/script');

function build(fragment) {
  const css = read('css/styles.css');
  const js = SCRIPTS.map((f) => '/* ===== ' + f + ' ===== */\n' + guard(read(f))).join('\n\n');

  const head = [
    '<title>' + TITLE + '</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="' + FONTS + '">',
    '<style>\n' + css + '\n</style>'
  ].join('\n');

  const bodyScripts = '<noscript>This simulator needs JavaScript enabled.</noscript>\n' +
    '<script>\n' + js + '\n</script>';

  if (fragment) return head + '\n' + bodyScripts + '\n';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="description" content="A day-by-day management simulator for an ' +
      'independent auto repair shop.">\n' +
    '<link rel="icon" href="' + FAVICON + '">\n' +
    head + '\n</head>\n<body>\n' + bodyScripts + '\n</body>\n</html>\n';
}

const isFragment = process.argv.includes('--fragment');
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, isFragment ? 'shop-floor.fragment.html' : 'shop-floor.html');
fs.writeFileSync(out, build(isFragment));
console.log('wrote ' + path.relative(ROOT, out) + ' (' +
  (fs.statSync(out).size / 1024).toFixed(1) + ' KB)');

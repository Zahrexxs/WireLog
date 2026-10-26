/**
 * Daily Task Logger — Single-Page Packager for Google Apps Script & Web
 * Inlines CSS and JS into client/index.html for zero-dependency standalone execution.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const cssContent = fs.readFileSync(path.join(ROOT_DIR, 'client/styles.css'), 'utf8');
const timeUtilsContent = fs.readFileSync(path.join(ROOT_DIR, 'server/timeUtils.js'), 'utf8');
const clockSyncContent = fs.readFileSync(path.join(ROOT_DIR, 'client/clockSync.js'), 'utf8');
const autocompleteContent = fs.readFileSync(path.join(ROOT_DIR, 'client/autocomplete.js'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT_DIR, 'client/app.js'), 'utf8');

let html = fs.readFileSync(path.join(ROOT_DIR, 'client/index.html'), 'utf8');

// Replace style block
const stylePattern = /<style>[\s\S]*?<\/style>/i;
const newStyle = `<style>\n${cssContent}\n</style>`;
if (stylePattern.test(html)) {
  html = html.replace(stylePattern, newStyle);
}

// Replace script blocks at the end
const scriptPattern = /<!-- Inlined or referenced scripts -->[\s\S]*?<\/body>/i;
const newScripts = `<!-- Inlined or referenced scripts -->
  <script>
${timeUtilsContent}
  </script>
  <script>
${clockSyncContent}
  </script>
  <script>
${autocompleteContent}
  </script>
  <script>
${appContent}
  </script>
</body>`;

if (scriptPattern.test(html)) {
  html = html.replace(scriptPattern, newScripts);
}

fs.writeFileSync(path.join(ROOT_DIR, 'client/index.html'), html);
console.log('Successfully compiled standalone client/index.html!');

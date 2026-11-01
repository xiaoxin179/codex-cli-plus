const fs = require('node:fs');
const path = require('node:path');

function loadSettings(directory, legacyDirectory) {
  const target = path.join(directory, 'settings.json');
  const exists = fs.existsSync(target);
  const source = exists ? target : path.join(legacyDirectory, 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
    if (!exists) {
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
    return settings;
  } catch { return {}; }
}

module.exports = { loadSettings };

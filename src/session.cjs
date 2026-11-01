const fs = require('node:fs');
const os = require('node:os');

function validDirectory(value) {
  if (typeof value !== 'string' || !value) return os.homedir();
  try { if (fs.statSync(value).isDirectory()) return value; } catch {}
  return os.homedir();
}

function dimensions(cols, rows) {
  return {
    cols: Math.max(2, Math.min(500, Math.floor(Number(cols) || 80))),
    rows: Math.max(2, Math.min(200, Math.floor(Number(rows) || 24)))
  };
}

function terminalEnvironment(parent = process.env, version = '') {
  const env = { ...parent };
  // A GUI terminal must advertise its own capabilities, not inherit the
  // automation host's no-color / noninteractive settings. Windows keys are
  // case insensitive, so remove aliases before adding canonical names.
  const replace = new Set(['NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE', 'TERM', 'COLORTERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'CODEX_CI']);
  for (const key of Object.keys(env)) if (replace.has(key.toUpperCase())) delete env[key];
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', CLICOLOR: '1', TERM_PROGRAM: 'CodexCLIPlus', TERM_PROGRAM_VERSION: version };
}

function shellArguments(command = '') {
  const integration = `$global:__ctOriginalPrompt = $function:prompt; function global:prompt { $ctResult = if ($?) { '0' } else { '1' }; $ctEsc = [string][char]27; $ctBel = [string][char]7; $ctPrompt = if ($global:__ctOriginalPrompt) { (& $global:__ctOriginalPrompt) -join '' } else { 'PS ' + $PWD + '> ' }; $ctEsc + ']133;D;' + $ctResult + $ctBel + $ctEsc + ']133;A' + $ctBel + $ctPrompt + $ctEsc + ']133;B' + $ctBel };`;
  return ['-NoLogo', '-NoExit', '-Command', integration + (command ? ` & { ${command}\n }` : '')];
}

module.exports = { validDirectory, dimensions, shellArguments, terminalEnvironment };

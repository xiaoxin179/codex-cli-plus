require('node:fs').writeFileSync(process.env.TERMINAL_ARGV_FILE, JSON.stringify(process.argv.slice(2)));

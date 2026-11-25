const { spawn } = require('child_process');
const exe = 'C:\\Users\\This PC\\AppData\\Local\\npm-cache\\_npx\\1323dbbc85759269\\node_modules\\electron\\dist\\electron.exe';
const child = spawn(exe, ['.'], { stdio: 'inherit' });
child.on('error', (e) => { console.error('Failed to launch:', e.message); process.exit(1); });
const { spawn } = require('child_process');
const exe = 'C:\\Users\\This PC\\Desktop\\JARVIS AI\\tools\\electron\\electron.exe';
const child = spawn(exe, ['.'], { stdio: 'inherit' });
child.on('error', (e) => { console.error('Failed to launch:', e.message); process.exit(1); });
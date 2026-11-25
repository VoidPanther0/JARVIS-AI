const { spawn } = require('child_process');
const exe = 'C:\\Users\\This PC\\AppData\\Local\\Programs\\Stonic AI\\Stonic AI.exe';
const child = spawn(exe, [process.cwd()], { stdio: 'inherit', detached: true, windowsHide: false });
child.unref();

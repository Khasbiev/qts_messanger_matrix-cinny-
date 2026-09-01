import { spawn } from 'child_process'

const proc = spawn('node', ['./node_modules/vite/bin/vite.js'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: false,
})

proc.on('exit', code => process.exit(code ?? 0))

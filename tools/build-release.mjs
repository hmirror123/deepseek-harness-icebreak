import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extension = JSON.parse(fs.readFileSync(path.join(source, 'extension.json'), 'utf8'));
if (process.platform !== 'win32') throw new Error('Release packaging currently requires Windows PowerShell.');
const media = fs.readFileSync(path.join(source, 'template', 'assets', 'icebreak.mp4'));
if (crypto.createHash('sha256').update(media).digest('hex') !== extension.mediaSha256) {
  throw new Error('Media checksum mismatch.');
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'icebreak-release-'));
const staged = path.join(temporary, extension.id);
const dist = path.join(source, 'dist');
const filename = extension.id + '-' + extension.version + '.zip';
const output = path.join(dist, filename);
try {
  fs.mkdirSync(staged);
  fs.mkdirSync(dist, { recursive: true });
  for (const entry of ['README.md', 'CREDITS.md', 'LICENSE', 'CHANGELOG.md', 'extension.json',
    'install.mjs', 'Launch.ps1', 'install.cmd', 'uninstall.cmd', 'template', 'licenses', 'tests', 'tools', 'docs']) {
    fs.cpSync(path.join(source, entry), path.join(staged, entry), { recursive: true });
  }
  if (fs.existsSync(output)) fs.unlinkSync(output);
  const packed = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:ICEBREAK_BUILD_SOURCE, $env:ICEBREAK_BUILD_DESTINATION, [System.IO.Compression.CompressionLevel]::Optimal, $true)'], {
    env: { ...process.env, ICEBREAK_BUILD_SOURCE: staged, ICEBREAK_BUILD_DESTINATION: output },
    encoding: 'utf8', windowsHide: true
  });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout || 'Could not create release archive.');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', digest + '  ' + filename + '\n');
  console.log(output);
  console.log('SHA256=' + digest);
} finally {
  if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('icebreak-release-')) {
    throw new Error('Refusing to remove a build directory outside the temporary workspace.');
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}

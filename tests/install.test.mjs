import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const id = 'deepseek-harness-icebreak';
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function fixture(t, version = '2.16.10') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'icebreak test '));
  const host = path.join(home, 'profiles', 'desktop', 'node_modules', 'dsh-boot-suite');
  fs.mkdirSync(host, { recursive: true });
  write(path.join(host, 'package.json'), { name: 'dsh-boot-suite', version });
  write(path.join(home, 'profiles', 'desktop', 'package.json'), {
    dsh: { profile: { bundles: ['dsh-boot-suite'] } }
  });
  const original = {
    enabled: false,
    mode: 'daily',
    template: 'archive-warm',
    act2: 'whale-girl-scan-4k-h264',
    speed: 1.3,
    requireInteraction: true,
    allowSkip: false,
    bgmEnabled: true,
    hiddenTemplates: ['hidden-template'],
    unrelated: { keep: true }
  };
  const config = path.join(home, 'dsh-startup.json');
  write(config, original);
  t.after(() => {
    const resolved = path.resolve(home);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('icebreak test '));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { home, config, original, target: path.join(home, 'startup-templates', id) };
}

function run(home, ...args) {
  return spawnSync(process.execPath, [
    path.join(packageRoot, 'install.mjs'), '--home', home, ...args
  ], { encoding: 'utf8' });
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('install and repeat install restore the original configuration on uninstall', t => {
  const f = fixture(t);
  succeeds(run(f.home));
  const installed = json(f.config);
  assert.equal(installed.template, id);
  assert.equal(installed.act1VideoSound, true);
  assert.equal(installed.mode, 'daily');
  assert.deepEqual(installed.unrelated, f.original.unrelated);
  assert.ok(fs.statSync(path.join(f.target, 'assets', 'icebreak.mp4')).size > 1000000);
  const player = fs.readFileSync(path.join(f.target, 'index.html'), 'utf8');
  assert.ok(!player.includes('<!-- ICEBREAK_MEDIA_BASE64 -->'));
  const payload = /<template id="media-payload">([A-Za-z0-9+/=]+)<\/template>/.exec(player);
  assert.ok(payload, 'Installed playback must contain its own media for the desktop sandbox');
  assert.ok(Buffer.from(payload[1], 'base64').equals(fs.readFileSync(path.join(f.target, 'assets', 'icebreak.mp4'))));
  succeeds(run(f.home));
  succeeds(run(f.home, '--uninstall'));
  assert.deepEqual(json(f.config), f.original);
  assert.equal(fs.existsSync(f.target), false);
  succeeds(run(f.home, '--uninstall'));
});

test('uninstall preserves preferences changed after installation', t => {
  const f = fixture(t);
  succeeds(run(f.home));
  write(f.config, {
    ...json(f.config),
    speed: 1.7,
    unrelated: { keep: 'updated' },
    template: 'another-template',
    hiddenTemplates: ['hidden-template', 'new-hidden']
  });
  succeeds(run(f.home, '--uninstall'));
  const actual = json(f.config);
  assert.equal(actual.speed, 1.7);
  assert.equal(actual.template, 'another-template');
  assert.deepEqual(actual.unrelated, { keep: 'updated' });
  assert.deepEqual(actual.hiddenTemplates, ['hidden-template', 'new-hidden']);
  assert.equal(actual.act2, f.original.act2);
});

test('reinstall backs up preferences changed between installations', t => {
  const f = fixture(t);
  succeeds(run(f.home));
  write(f.config, { ...json(f.config), template: 'another-template', speed: 1.8 });
  succeeds(run(f.home));
  succeeds(run(f.home, '--uninstall'));
  const actual = json(f.config);
  assert.equal(actual.template, 'another-template');
  assert.equal(actual.speed, 1.8);
  assert.equal(actual.allowSkip, f.original.allowSkip);
});

test('an active installation lock leaves the configuration untouched', t => {
  const f = fixture(t);
  const templates = path.join(f.home, 'startup-templates');
  fs.mkdirSync(templates);
  fs.writeFileSync(path.join(templates, '.' + id + '.lock'), String(process.pid));
  const result = run(f.home);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Another icebreak installer/);
  assert.deepEqual(json(f.config), f.original);
  assert.equal(fs.existsSync(f.target), false);
});

test('an unsupported host version does not change settings or install a template', t => {
  const f = fixture(t, '2.15.9');
  assert.notEqual(run(f.home).status, 0);
  assert.deepEqual(json(f.config), f.original);
  assert.equal(fs.existsSync(f.target), false);
});

test('a template owned by another installer is left in place', t => {
  const f = fixture(t);
  fs.mkdirSync(f.target, { recursive: true });
  fs.writeFileSync(path.join(f.target, 'keep.txt'), 'owned by user');
  assert.notEqual(run(f.home).status, 0);
  assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'owned by user');
  assert.deepEqual(json(f.config), f.original);
});

test('a source checkout without the film leaves settings untouched and explains the release download', t => {
  const f = fixture(t);
  const checkout = path.join(f.home, 'source-checkout');
  fs.mkdirSync(checkout);
  for (const file of ['install.mjs', 'extension.json']) {
    fs.copyFileSync(path.join(packageRoot, file), path.join(checkout, file));
  }
  const result = spawnSync(process.execPath, [path.join(checkout, 'install.mjs'), '--home', f.home], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Download the complete release ZIP/);
  assert.deepEqual(json(f.config), f.original);
  assert.equal(fs.existsSync(f.target), false);
});

test('the PowerShell launcher works with a home path containing spaces', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(packageRoot, 'Launch.ps1'),
    '-DshHome', f.home
  ], { encoding: 'utf8' });
  succeeds(result);
  assert.equal(json(f.config).template, id);
  succeeds(run(f.home, '--uninstall'));
});

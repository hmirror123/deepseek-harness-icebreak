import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const id = 'deepseek-harness-icebreak';
const args = process.argv.slice(2);
const homeIndex = args.indexOf('--home');
const home = path.resolve(homeIndex >= 0
  ? args[homeIndex + 1] || ''
  : process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
const templates = path.join(home, 'startup-templates');
const target = path.join(templates, id);
const configFile = path.join(home, 'dsh-startup.json');
const stateName = 'icebreak-install-state.json';
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function assertTemplateChild(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(templates)) {
    throw new Error('Refusing to change a directory outside startup-templates.');
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('Refusing to replace a linked template directory.');
  }
  return resolved;
}

function atomicJson(file, data) {
  const temporary = file + '.icebreak-' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function removeDirectory(directory) {
  fs.rmSync(assertTemplateChild(directory), { recursive: true, force: true });
}

function checkHost() {
  const profile = path.join(home, 'profiles', 'desktop');
  const manifest = readJson(path.join(profile, 'package.json'));
  if (!manifest.dsh?.profile?.bundles?.includes('dsh-boot-suite')) {
    throw new Error('The desktop profile must enable dsh-boot-suite first.');
  }
  const host = readJson(path.join(profile, 'node_modules', 'dsh-boot-suite', 'package.json'));
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(host.version);
  const version = match && match.slice(1).map(Number);
  if (!version || version[0] < 2 ||
      (version[0] === 2 && version[1] < 16) ||
      (version[0] === 2 && version[1] === 16 && version[2] < 7)) {
    throw new Error('dsh-boot-suite 2.16.7 or later is required.');
  }
}

function acquireLock() {
  const lock = path.join(templates, '.' + id + '.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = fs.openSync(lock, 'wx');
      fs.writeFileSync(descriptor, String(process.pid));
      return () => {
        fs.closeSync(descriptor);
        fs.unlinkSync(lock);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid installation lock.');
      try {
        process.kill(pid, 0);
      } catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError;
        fs.unlinkSync(lock);
        continue;
      }
      throw new Error('Another icebreak installer is running.');
    }
  }
  throw new Error('Could not acquire the installation lock.');
}

function install() {
  checkHost();
  const extension = readJson(path.join(source, 'extension.json'));
  const mediaFile = path.join(source, 'template', 'assets', 'icebreak.mp4');
  if (!fs.existsSync(mediaFile)) {
    throw new Error('The source checkout does not include the film. Download the complete release ZIP from https://github.com/hmirror123/deepseek-harness-icebreak/releases/latest .');
  }
  const media = fs.readFileSync(mediaFile);
  const digest = crypto.createHash('sha256').update(media).digest('hex');
  if (extension.id !== id || digest !== extension.mediaSha256) {
    throw new Error('The media checksum does not match this package.');
  }
  const existing = fs.existsSync(target);
  let state;
  if (existing) {
    state = readJson(path.join(assertTemplateChild(target), stateName));
    if (state.id !== id || state.schemaVersion !== 1) {
      throw new Error('The existing template was not created by this installer.');
    }
  }
  const staging = assertTemplateChild(path.join(templates, '.' + id + '-stage-' + crypto.randomUUID()));
  const old = assertTemplateChild(path.join(templates, '.' + id + '-old-' + crypto.randomUUID()));
  let published = false;
  let movedOld = false;
  try {
    fs.cpSync(path.join(source, 'template'), staging, { recursive: true, errorOnExist: true });
    const playerFile = path.join(staging, 'index.html');
    const player = fs.readFileSync(playerFile, 'utf8');
    const placeholder = '<!-- ICEBREAK_MEDIA_BASE64 -->';
    if (player.split(placeholder).length !== 2) throw new Error('The player media placeholder is missing or repeated.');
    fs.writeFileSync(playerFile, player.replace(placeholder, media.toString('base64')));
    const config = readJson(configFile);
    const applied = {
      enabled: true,
      template: id,
      act2: 'none',
      act1VideoSound: true,
      speed: 1,
      requireInteraction: false,
      allowSkip: true,
      bedNoise: false,
      bgmEnabled: false,
      hiddenTemplates: (config.hiddenTemplates || []).filter(value => value !== id)
    };
    if (!state) {
      state = {
        schemaVersion: 1,
        id,
        previous: Object.fromEntries(Object.keys(applied).map(key => [
          key, { present: Object.hasOwn(config, key), value: config[key] }
        ]))
      };
    } else {
      for (const key of Object.keys(applied)) {
        if (!equal(config[key], state.applied[key])) {
          state.previous[key] = { present: Object.hasOwn(config, key), value: config[key] };
        }
      }
    }
    state.applied = applied;
    atomicJson(path.join(staging, stateName), state);
    if (existing) {
      fs.renameSync(assertTemplateChild(target), old);
      movedOld = true;
    }
    fs.renameSync(staging, assertTemplateChild(target));
    published = true;
    atomicJson(configFile, { ...config, ...applied });
  } catch (error) {
    if (published) removeDirectory(target);
    if (movedOld) fs.renameSync(old, target);
    if (fs.existsSync(staging)) removeDirectory(staging);
    throw error;
  }
  if (movedOld) {
    try {
      removeDirectory(old);
    } catch (error) {
      console.warn('Installed. A previous package remains at ' + old + ': ' + error.message);
    }
  }
  console.log('Installed icebreak startup template at ' + target);
  console.log('Selected for the desktop profile. Reopen DeepSeek Harness to play it.');
}

function uninstall() {
  if (!fs.existsSync(target)) {
    console.log('The icebreak template is already uninstalled.');
    return;
  }
  const state = readJson(path.join(assertTemplateChild(target), stateName));
  if (state.id !== id || state.schemaVersion !== 1) {
    throw new Error('Refusing to remove a template owned by another installer.');
  }
  const config = readJson(configFile);
  for (const [key, applied] of Object.entries(state.applied)) {
    if (!equal(config[key], applied)) continue;
    const previous = state.previous[key];
    if (previous.present) config[key] = previous.value;
    else delete config[key];
  }
  if (config.template === id || config.act2 === id) {
    throw new Error('The template is still selected. Choose another startup template first.');
  }
  const retired = assertTemplateChild(path.join(templates, '.' + id + '-remove-' + crypto.randomUUID()));
  fs.renameSync(target, retired);
  try {
    atomicJson(configFile, config);
  } catch (error) {
    fs.renameSync(retired, target);
    throw error;
  }
  removeDirectory(retired);
  console.log('Uninstalled icebreak. Restored unchanged startup settings from the backup.');
}

try {
  if (homeIndex >= 0 && !args[homeIndex + 1]) throw new Error('--home needs a path.');
  if (!fs.existsSync(configFile)) throw new Error('No DeepSeek Harness startup configuration found at ' + home);
  fs.mkdirSync(templates, { recursive: true });
  const release = acquireLock();
  try {
    if (args.includes('--uninstall')) uninstall();
    else install();
  } finally {
    release();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

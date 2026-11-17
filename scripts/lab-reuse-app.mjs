// Viewer lab (QA only): fetch the simulator app built by an earlier lab run, so a JS-only change is re-checked without
// the 40-minute native build. The run id comes from qa/lab/reuse-app.txt; anything missing means "build normally".
// Prints exactly one line for $GITHUB_OUTPUT: app=1 (lab-reuse/Paperly.app.tgz is ready) or app=0.
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const done = (ok, why) => { console.error('reuse:', why); console.log('app=' + (ok ? 1 : 0)); process.exit(0); };
try {
  const run = (fs.existsSync('qa/lab/reuse-app.txt') ? fs.readFileSync('qa/lab/reuse-app.txt', 'utf8') : '').replace(/\D/g, '');
  if (!run) done(false, 'no run named, full build');
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN; if (!repo || !token) done(false, 'no repository / token');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  const list = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run}/artifacts?per_page=50`, { headers }).then(r => r.json());
  const art = (list.artifacts ?? []).find(a => a.name === 'viewer-lab-ios-app' && !a.expired); if (!art) done(false, 'run ' + run + ' has no app artifact');
  const res = await fetch(art.archive_download_url, { headers }); if (!res.ok) done(false, 'download ' + res.status);
  fs.mkdirSync('lab-reuse', { recursive: true }); fs.writeFileSync('lab-reuse/app.zip', Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', 'lab-reuse/app.zip', '-d', 'lab-reuse']);
  if (!fs.existsSync('lab-reuse/Paperly.app.tgz')) done(false, 'archive missing in the artifact');
  done(true, 'using the app of run ' + run + ' (' + Math.round(art.size_in_bytes / 1048576) + ' MB)');
} catch (e) { done(false, 'failed: ' + String(e?.message ?? e)); }

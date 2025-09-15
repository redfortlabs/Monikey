// cli.js
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function usage() {
  console.error(`Usage: node cli.js <https://site[/path]> [--ack]
  --ack   Acknowledge you have permission to scan the target site.`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const ack = args.includes('--ack');
const urlArg = args.find(a => !a.startsWith('-'));
if (!urlArg) usage();

let target;
try {
  target = new URL(urlArg);
  if (!/^https?:$/.test(target.protocol)) throw new Error('Only http/https allowed');
} catch (e) {
  console.error('Error: invalid URL. Provide full URL like https://example.com');
  process.exit(1);
}

if (!ack) {
  console.error('Safety check: Use --ack to confirm you have permission to scan this site.');
  console.error('Example: node cli.js https://example.com --ack');
  process.exit(1);
}

// --- Allowlist enforcement ---
const allowPath = path.join(process.cwd(), 'allowlist.json');
let allow = { hosts: [] };
try {
  if (fs.existsSync(allowPath)) {
    allow = JSON.parse(fs.readFileSync(allowPath, 'utf8'));
  }
} catch (e) {
  console.error('Failed to read allowlist.json:', e.message);
  process.exit(1);
}
const allowed = Array.isArray(allow.hosts) && allow.hosts.some(h => h && target.hostname.endsWith(h));
if (!allowed) {
  console.error(`Blocked: ${target.hostname} is not in allowlist.json.`);
  console.error(`Add it under "hosts" to proceed. Example: { "hosts": ["${target.hostname}"] }`);
  process.exit(1);
}

// --- robots.txt helpers ---
function fetchText(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirect = new URL(res.headers.location, url).toString();
          res.resume();
          resolve(fetchText(redirect, timeoutMs));
          return;
        } catch {
          res.resume();
          return resolve(null);
        }
      }
      if (res.statusCode && res.statusCode >= 400) { res.resume(); return resolve(null); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function parseRobots(txt) {
  const lines = (txt || '').split(/\r?\n/).map(l => l.trim());
  let inStar = false;
  const rules = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') { inStar = (val === '*'); continue; }
    if (!inStar) continue;
    if (key === 'disallow' || key === 'allow') {
      let p = val;
      if (p === '' || p === undefined || p === null) p = '';
      if (p && !p.startsWith('/')) p = '/' + p;
      rules.push({ type: key, path: p });
    }
  }
  return rules;
}

function longestMatchDecision(rules, pathname) {
  if (!rules.length) return { allowed: true, reason: 'no-rules' };
  const matches = rules
    .filter(r => r.path === '' || pathname.startsWith(r.path))
    .sort((a,b) => (b.path.length - a.path.length));
  if (!matches.length) return { allowed: true, reason: 'no-match' };
  const winner = matches[0];
  return (winner.type === 'allow')
    ? { allowed: true, reason: `allow:${winner.path}` }
    : { allowed: false, reason: `disallow:${winner.path}` };
}

(async () => {
  // --- robots.txt check ---
  const robotsUrl = `${target.origin}/robots.txt`;
  const robotsTxt = await fetchText(robotsUrl);
  if (robotsTxt === null) {
    console.log(`robots.txt: none or unreachable (${robotsUrl}) — proceeding.`);
  } else {
    const rules = parseRobots(robotsTxt);
    const decision = longestMatchDecision(rules, target.pathname || '/');
    if (!decision.allowed) {
      console.error(`Blocked by robots.txt (${robotsUrl}) → ${decision.reason}`);
      process.exit(1);
    } else {
      console.log(`robots.txt: allowed (${decision.reason}).`);
    }
  }

  // Ensure reports dir
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  // Build filename
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T','_').slice(0,15);
  const fname = `${stamp}-${target.hostname}.json`;
  const outPath = path.join(reportsDir, fname);

  const child = execFile(process.execPath, ['detect.js', target.href], { cwd: process.cwd() }, (err, stdout, stderr) => {
    if (err) {
      console.error('Scan failed:', err.message);
      if (stderr) console.error(stderr);
      process.exit(1);
    }
    try {
      fs.writeFileSync(outPath, stdout);
      console.log(`\nSaved report → ${outPath}`);
    } catch (e) {
      console.error('Failed to write report:', e.message);
      process.exit(1);
    }

    try {
      const report = JSON.parse(stdout);
      const add = report.addEventListener || [];
      const inline = report.inlineHandlers || [];

      console.log('\n===== MoniKey Summary =====');
      console.log(`URL: ${report.url}`);
      console.log(`When: ${report.timestamp}`);
      console.log(`addEventListener: ${add.length} | inline handlers: ${inline.length}`);

      // --- Heuristic findings ---
      const findings = [];
      const isFormy = sel => /^input|textarea|select|form/i.test((sel||'').split(/[#.]/)[0]);
      const isGlobal = sel => !sel || sel === '(unknown)' || /^window|^document|^body/i.test(sel);
      for (const r of add) {
        const sel = r.selector || r.target || '(unknown)';
        const t = (r.type||'').toLowerCase();
        if (isGlobal(sel) && ['keydown','keypress','keyup','input','beforeinput'].includes(t)) {
          findings.push({ level: 'high', msg: `Global ${t} listener (possible keystroke capture)` });
        }
        if (isGlobal(sel) && t === 'paste') {
          findings.push({ level: 'medium', msg: 'Global paste listener (could catch clipboard data)' });
        }
        if (!isFormy(sel) && ['keydown','keypress','keyup','beforeinput'].includes(t)) {
          findings.push({ level: 'medium', msg: `${t} on non-form element: ${sel}` });
        }
        if (!isFormy(sel) && t === 'input') {
          findings.push({ level: 'low', msg: `input event on non-form element: ${sel}` });
        }
      }
      if (inline.length) {
        findings.push({ level: 'low', msg: `Inline handlers present (${inline.length})` });
      }

      // Group addEventListener by selector+type
      const map = new Map();
      for (const r of add) {
        const key = `${r.selector || r.target || '(unknown)'}|${r.type}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
      const top = [...map.entries()]
        .map(([k, count]) => {
          const [sel, type] = k.split('|');
          return { selector: sel, type, count };
        })
        .sort((a,b) => b.count - a.count)
        .slice(0, 10);

      if (top.length) {
        console.log('\nTop listener targets:');
        for (const t of top) console.log(`• ${t.selector} — ${t.type} (${t.count})`);
      } else {
        console.log('\nNo key/input listeners detected.');
      }

      if (inline.length) {
        console.log('\nInline handlers found (showing up to 5):');
        for (const h of inline.slice(0,5)) {
          console.log(`• ${h.selector} — on${h.type} (code: "${(h.codePreview||'').replace(/\s+/g,' ').slice(0,60)}")`);
        }
        if (inline.length > 5) console.log(`… and ${inline.length - 5} more`);
      }
      console.log('============================\n');

      // Print findings
      if (findings.length) {
        console.log('--- Findings (heuristic) ---');
        for (const f of findings) console.log(`• [${f.level.toUpperCase()}] ${f.msg}`);
        console.log('----------------------------\n');
      } else {
        console.log('No heuristic findings.\n');
      }

    } catch (e) {
      console.error('Note: could not render pretty summary:', e.message);
    }
  });

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
})();

import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const filename = '.env.auth-keys';
try { await access(filename); }
catch {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const privateKey = await exportPKCS8(pair.privateKey);
  const jwk = await exportJWK(pair.publicKey);
  const values = `JWT_PRIVATE_KEY="${privateKey.trimEnd().replace(/\n/g, ' ')}"\nJWKS=${JSON.stringify({ keys: [{ use: 'sig', ...jwk }] })}\n`;
  await writeFile(filename, values, { mode: 0o600, flag: 'wx' });
}
const result = spawnSync('./node_modules/.bin/convex', ['env','set','--from-file',filename], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

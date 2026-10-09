import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { SignJWT, importPKCS8 } from 'jose';
function runConvex(args) { const r=spawnSync('./node_modules/.bin/convex',args,{encoding:'utf8'}); if(r.status!==0) throw new Error('Convex QA operation failed: '+args[0]); return r.stdout; }
const configuration=parseEnv(await readFile('.env.local','utf8'));
if(!configuration.CONVEX_DEPLOYMENT?.startsWith('dev:')) throw new Error('Live QA requires a development deployment.');
const fixtureSource=(await readFile('tests/fixtures/qaFunctions.ts','utf8')).replace("from '../../convex/_generated/server'","from './_generated/server'");
await writeFile('convex/qaFixtures.ts',fixtureSource);
runConvex(['dev','--once']);
const fixtures=JSON.parse(runConvex(['run','qaFixtures:seed','{}']));
const env=parseEnv(await readFile('.env.local','utf8'));
const keys=parseEnv(await readFile('.env.auth-keys','utf8'));
const privateKey=await importPKCS8(keys.JWT_PRIVATE_KEY,'RS256');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const contexts=[]; const pages=[]; const errors=[];
try {
 for(const fixture of fixtures) {
  const token=await new SignJWT({sub:`${fixture.userId}|${fixture.sessionId}`}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setIssuer(env.VITE_CONVEX_SITE_URL).setAudience('convex').setExpirationTime('30m').sign(privateKey);
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}); contexts.push(ctx);
  await ctx.addInitScript(({token,refresh,namespace})=>{ if (!localStorage.getItem(`__convexAuthJWT_${namespace}`)) { localStorage.setItem(`__convexAuthJWT_${namespace}`,token); localStorage.setItem(`__convexAuthRefreshToken_${namespace}`,refresh); } },{token,refresh:`${fixture.refreshId}|${fixture.sessionId}`,namespace:env.VITE_CONVEX_URL.replace(/[^a-zA-Z0-9]/g,'')});
  const page=await ctx.newPage(); page.on('pageerror',e=>errors.push(e.message)); pages.push(page);
  await page.goto('http://127.0.0.1:5174/');
  await expect(page.getByRole('button',{name:'New space',exact:true}).first()).toBeVisible({timeout:20000});
 }
 const [owner,guest]=pages;
 await owner.getByRole('button',{name:'New space',exact:true}).first().click();
 await owner.getByLabel('Name',{exact:true}).fill('Realtime QA');
 await owner.getByRole('button',{name:'Create',exact:true}).click();
 await expect(owner.getByRole('textbox',{name:'Message Realtime QA'})).toBeVisible();
 await owner.getByRole('button',{name:'Members (1)',exact:true}).click();
 await owner.getByLabel('Invite by email',{exact:true}).fill(fixtures[1].email);
 await owner.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(guest.getByRole('button',{name:'Accept',exact:true})).toBeVisible({timeout:15000});
 await guest.getByRole('button',{name:'Accept',exact:true}).click();
 await expect(guest.getByRole('textbox',{name:'Message Realtime QA'})).toBeVisible();
 await owner.keyboard.press('Escape');
 const msg='Hello from the first browser';
 await owner.getByRole('textbox',{name:'Message Realtime QA'}).fill(msg);
 await owner.getByRole('button',{name:'Send',exact:true}).click();
 await expect(guest.getByText(msg,{exact:true})).toBeVisible({timeout:15000});
 const reply='Received in the second browser';
 await guest.getByRole('textbox',{name:'Message Realtime QA'}).fill(reply);
 await guest.getByRole('button',{name:'Send',exact:true}).click();
 await expect(owner.getByText(reply,{exact:true})).toBeVisible({timeout:15000});
 await guest.reload();
 await expect(guest.getByText(msg,{exact:true})).toBeVisible({timeout:15000});
 await expect(guest.getByText(reply,{exact:true})).toBeVisible();
 await guest.getByRole('textbox',{name:'Message Realtime QA'}).fill('Draft survives refresh');
 await guest.waitForTimeout(100);
 await guest.reload();
 await expect(guest.getByRole('textbox',{name:'Message Realtime QA'})).toHaveValue('Draft survives refresh',{timeout:15000});
 // Chrome network emulation closes the websocket and exercises the durable outbox.
 await contexts[1].setOffline(true);
 await guest.getByRole('textbox',{name:'Message Realtime QA'}).fill('Queued while offline');
 await guest.getByRole('button',{name:'Send',exact:true}).click();
 await expect(guest.getByText('Queued while offline',{exact:true})).toBeVisible();
 await contexts[1].setOffline(false);
 await expect(owner.getByText('Queued while offline',{exact:true})).toBeVisible({timeout:30000});
 await expect(owner.getByText('Queued while offline',{exact:true})).toHaveCount(1);
 await owner.screenshot({path:'/tmp/common-live-chat.png',fullPage:true});
 await owner.getByRole('button',{name:'Members (2)',exact:true}).click();
 await owner.getByRole('button',{name:'Remove QA Guest',exact:true}).click();
 await owner.getByRole('button',{name:'Remove',exact:true}).click();
 await expect(guest.getByRole('textbox',{name:'Message Realtime QA'})).not.toBeVisible({timeout:15000});
 await writeFile('/tmp/common-live-result.json',JSON.stringify({passed:true,checks:['space creation','email invitation','recipient acceptance','two-way realtime messages','history after reload','draft recovery','offline send reconnects exactly once','live membership revocation'],errors},null,2));
 console.log('Live browser checks passed.');
} catch(e) {
 for(let i=0;i<pages.length;i++) { await pages[i].screenshot({path:`/tmp/common-qa-failure-${i}.png`,fullPage:true}); console.log(`Browser ${i}:`,await pages[i].locator('body').innerText()); }
 console.log('Browser errors:',errors); throw e;
} finally {
 await browser.close();
 runConvex(['run','qaFixtures:cleanup',JSON.stringify({userIds:fixtures.map(f=>f.userId)})]);
 await unlink('convex/qaFixtures.ts');
 runConvex(['dev','--once']);
 console.log('QA fixtures and test functions removed.');
}

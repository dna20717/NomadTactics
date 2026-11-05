// Interaction test of the Tactics workshop in the browser (headless). Beforehand in the repo: python3 -m http.server 8790
import fs from 'node:fs'; fs.mkdirSync('/tmp/cmp', { recursive: true });
//   node tools/workshop_test.mjs   → Ausgaben + Bilder in /tmp/cmp
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const s = await ctx.newPage(); s.setDefaultTimeout(30000);
s.on('pageerror', e => console.log('ERROR:', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
await s.goto('http://localhost:8790/tactics.html');
await s.waitForFunction(() => window.workshop?.p && !document.getElementById('tk-load'));
const z = () => s.evaluate(() => { const f = workshop.p.factions.get('ukraine'); return { modify: f.generals.brannick.modify.units.schrottpanzer, basis: f.units.schrottpanzer.speed, undo: workshop.undo.length, dirty: [...workshop.dirty] }; });
await s.evaluate(() => workshop.go({ area: 'faction', faction: 'ukraine', sub: 'units', choice: 'schrottpanzer', general: 'brannick' }));
// Change tempo on the general
const speed = s.locator('.da-insp label.da-field', { hasText: 'Tempo' }).locator('input');
await speed.fill('4'); await speed.dispatchEvent('change');
console.log('nach Tempo 4:', JSON.stringify(await z()));
// Reset via ↺ at the tempo
await s.locator('.da-insp label.da-field', { hasText: 'Tempo' }).locator('.tk-back').click();
console.log('nach ↺:', JSON.stringify(await z()));
// Undo brings the tempo back
await s.keyboard.press('Control+z'); await s.waitForTimeout(200);
console.log('nach Undo:', JSON.stringify(await z()));
// Without at Brannick: rocket truck
await s.evaluate(() => workshop.go({ ...workshop.page, choice: 'raketenlaster' }));
await s.locator('.da-insp button', { hasText: 'Ohne bei' }).click();
console.log('without:', JSON.stringify(await s.evaluate(() => workshop.p.factions.get('ukraine').generals.brannick.without)));
// New research in the tech tree by double-click and connect via API
await s.evaluate(() => workshop.go({ area: 'faction', faction: 'usa', sub: 'techTree', general: null }));
const fl = s.locator('.da-surface'); const bb = await fl.boundingBox();
await s.mouse.dblclick(bb.x + 30, bb.y + 30);
console.log('neue Forschung:', await s.evaluate(() => workshop.page.choice), JSON.stringify(await s.evaluate(() => workshop.p.factions.get('usa').research[workshop.page.choice]?.pos)));
// Speichern + neu laden
await s.keyboard.press('Control+s'); await s.waitForTimeout(500);
console.log('Status:', await s.locator('.ed-status').innerText());
await s.reload(); await s.waitForFunction(() => window.workshop?.p && !document.getElementById('tk-load'));
console.log('nach Reload ohne:', JSON.stringify(await s.evaluate(() => workshop.p.factions.get('ukraine').generals.brannick.without)), 'Stand:', await s.locator('.tk-state').innerText().catch(() => '-'));
await s.evaluate(() => workshop.go({ area: 'faction', faction: 'usa', sub: 'units', choice: 'kampfpanzer' }));
await s.screenshot({ path: '/tmp/cmp/tk_after.png' });
// Umbenennen Waffe global
await s.evaluate(() => workshop.go({ area: 'weapons', choice: 'kanone_120' }));
const id = s.locator('.da-insp input.as-id'); await id.fill('kanone_l55'); await id.dispatchEvent('change');
console.log('Kampfpanzer-Waffen:', JSON.stringify(await s.evaluate(() => workshop.p.factions.get('usa').units.kampfpanzer.weapons)), 'Prüfung:', await s.locator('.tk-checkButton').innerText());
await s.screenshot({ path: '/tmp/cmp/tk_weapon2.png' });
await b.close();

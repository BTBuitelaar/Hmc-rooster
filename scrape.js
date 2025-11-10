const { chromium } = require('playwright');
const fs = require('fs');
const { buildICS } = require('./ics');

const MONTHS = { janu:1,febru:2,maart:3,april:4,mei:5,juni:6,juli:7,augus:8,septe:9,oktob:10,novem:11,decem:12 };
const WHEN = new RegExp('(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\\s+(\\d{1,2})\\s+([a-z]+)\\s+(20\\d{2}),\\s*(\\d{1,2}:\\d{2})\\s*-\\s*(\\d{1,2}:\\d{2})','i');

function monthFrom(nl) {
  if (!nl) return null;
  const key = nl.toLowerCase().slice(0,5);
  for (const k of Object.keys(MONTHS)) {
    if (key.startsWith(k)) return MONTHS[k];
  }
  return null;
}
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const e of arr) {
    const k = `${+e.start}|${+e.end}|${e.title}|${e.location}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  out.sort((a,b) => a.start - b.start);
  return out;
}
async function parseVisibleWeek(page) {
  return await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('div.k-event[aria-label]'));
    return nodes.map(el => el.getAttribute('aria-label'));
  });
}
function parseAriaLabels(labels) {
  const events = [];
  for (const a of labels) {
    const m = a.match(WHEN);
    if (!m) continue;
    const d = +m[2];
    const mo = monthFrom(m[3]);
    if (!mo) continue;
    const y = +m[4];
    const [sh, sm] = m[5].split(':').map(Number);
    const [eh, em] = m[6].split(':').map(Number);
    const after = a.split(m[0])[1] || '';
    const t1 = after.match(/\b(?:les|examen)\s+([^,]+)/i);
    let title = t1 ? t1[1].trim() : '';
    if (!title) {
      const t2 = a.match(/,\s*(?:les|examen)\s+([^,]+)/i);
      if (t2) title = t2[1].trim();
    }
    title = title.replace(/^(les|examen?)\s+/i, '');
    let location = '';
    const locm = a.match(/faciliteit\s+([^,]+?)(?:\s*-\s*([A-Z]?\d{1,4}[A-Z]?))?(?:,|$)/i);
    if (locm) {
      const site = (locm[1] || '').trim();
      const room = (locm[2] || '').trim();
      location = room ? `${site} - ${room}` : site;
    }
    const start = new Date(y, mo - 1, d, sh, sm, 0);
    const end   = new Date(y, mo - 1, d, eh, em, 0);
    if (!isNaN(+start) && !isNaN(+end)) {
      events.push({ start, end, title: title || 'Les', location });
    }
  }
  return dedupe(events);
}

// Main wrapper with error logging and longer timeout
(async () => {
  try {
    const weeks    = Number(process.env.MYX_WEEKS || 8);
    const username = process.env.MYX_USERNAME;
    const password = process.env.MYX_PASSWORD;

    if (!username || !password) {
      console.error('Missing MYX_USERNAME or MYX_PASSWORD');
      process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const ctx     = await browser.newContext();
    const page    = await ctx.newPage();

    // Navigate to MyX
    await page.goto('https://hmcollege.myx.nl/roster/overview/schedule/mine', { waitUntil: 'domcontentloaded' });

    // Some institutions ask for an identifier first (SURF login).
    const maybePicker = await page.locator('input[name="userId"]').first();
    if (await maybePicker.count()) {
      await maybePicker.fill(username);
      await maybePicker.press('Enter');
    }

    // Fill username/password on the actual login page
    const userField = page.locator('input[type="email"], input[name="username"], input#username').first();
    const passField = page.locator('input[type="password"], input#password').first();
    if (await userField.count()) await userField.fill(username);
    if (await passField.count()) {
      await passField.fill(password);
      await passField.press('Enter');
    }

    // Increase the timeout to 120 seconds for slow page loads
    await page.waitForSelector('kendo-scheduler, .k-scheduler', { timeout: 120000 });

    let all = [];
    for (let i = 0; i < weeks; i++) {
      // Wait a bit for events to render
      await page.waitForTimeout(1000);
      const labels = await parseVisibleWeek(page);
      all = dedupe(all.concat(parseAriaLabels(labels)));

      // Click to next week if available
      if (i < weeks - 1) {
        const nextBtn =
          await page.$('button[data-cy="next-button"]') ||
          await page.$('kendo-scheduler-toolbar button.k-button[aria-label*="Volgende"]');
        if (!nextBtn) break;
        await nextBtn.click();
      }
    }

    const ics = buildICS(all);
    fs.writeFileSync('rooster.ics', ics, 'utf8');
    console.log(`Generated ${all.length} events into rooster.ics`);
    await browser.close();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

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
  for (const label of labels) {
    const m = label.match(WHEN);
    if (!m) continue;
    const [, day, d, monthNL, y, startT, endT] = m;
    const month = monthFrom(monthNL);
    if (!month) continue;
    const start = new Date(`${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}T${startT}`);
    const end = new Date(`${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}T${endT}`);
    const title = label.split(',')[1]?.trim() || 'Les';
    const location = label.split(' - ').pop()?.trim() || '';
    events.push({ start, end, title, location });
  }
  return events;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Opening MyX login page...');
  await page.goto('https://myx.hmc.nl/');
  await page.waitForSelector('input[name="username"]');

  console.log('Logging in...');
  await page.fill('input[name="username"]', process.env.MYX_USERNAME);
  await page.fill('input[name="password"]', process.env.MYX_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for main page load
  await page.waitForLoadState('networkidle');

  // 🆕 After login: open view dropdown and select “Week”
  const viewButton = await page.$('button[aria-label="Open rooster opties"]');
  if (viewButton) {
    await viewButton.click();
    const weekOption = await page.$('button:has-text("Week")');
    if (weekOption) {
      console.log('Switching to Week view...');
      await weekOption.click();
    } else {
      console.log('Week option not found — continuing...');
    }
  } else {
    console.log('No view button found — continuing...');
  }

  // scrape visible data
  console.log('Scraping schedule...');
  const rawLabels = await parseVisibleWeek(page);
  const events = parseAriaLabels(rawLabels);
  const deduped = dedupe(events);

  console.log(`Found ${deduped.length} unique events. Generating ICS...`);
  const icsData = buildICS(deduped);
  fs.writeFileSync('rooster.ics', icsData);

  console.log('ICS file saved as rooster.ics');
  await browser.close();
})();

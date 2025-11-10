const { chromium } = require('playwright');
const fs = require('fs');
const { buildICS } = require('./ics');

const MONTHS = {
  janu: 1,
  febru: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augus: 8,
  septe: 9,
  oktob: 10,
  novem: 11,
  decem: 12,
};

const WHEN = new RegExp(
  '(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\\s+(\\d{1,2})\\s+([a-z]+)\\s+(20\\d{2}),\\s*(\\d{1,2}:\\d{2})\\s*-\\s*(\\d{1,2}:\\d{2})',
  'i'
);

function monthFrom(nl) {
  if (!nl) return null;
  const key = nl.toLowerCase().slice(0, 5);
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
  out.sort((a, b) => a.start - b.start);
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
    const m = WHEN.exec(label);
    if (!m) continue;
    const [, , day, monthNL, year, start, end] = m;
    const month = monthFrom(monthNL);
    if (!month) continue;

    const title = label.split(',')[1]?.trim() || 'Onbekend';
    const locationMatch = label.match(/\s-\s([A-Z0-9]+)$/);
    const location = locationMatch ? locationMatch[1] : '';

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);

    const startDate = new Date(year, month - 1, day, sh, sm);
    const endDate = new Date(year, month - 1, day, eh, em);

    events.push({ start: startDate, end: endDate, title, location });
  }
  return events;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Opening MyX login page...');
  await page.goto('https://hmcollege.myx.nl/roster/overview/schedule/0', { waitUntil: 'load' });

  await page.fill('input[name="username"]', process.env.MYX_USERNAME);
  await page.fill('input[name="password"]', process.env.MYX_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: 'networkidle' });
  console.log('Logged in successfully.');

  // Ensure week view is selected
  const viewButton = await page.$('button[aria-label="Open rooster opties"]');
  if (viewButton) {
    await viewButton.click();
    const weekOption = await page.$('button:has-text("Week")');
    if (weekOption) {
      await weekOption.click();
      console.log('Switched to week view.');
    }
  }

  // Wait for events to load
  await page.waitForSelector('div.k-event[aria-label]', { timeout: 15000 });

  let allEvents = [];
  const totalWeeks = parseInt(process.env.MYX_WEEKS || '8', 10);

  for (let i = 0; i < totalWeeks; i++) {
    console.log(`Parsing week ${i + 1}/${totalWeeks}...`);
    const labels = await parseVisibleWeek(page);
    const events = parseAriaLabels(labels);
    allEvents = allEvents.concat(events);

    // Click next week if available
    const nextButton = await page.$('button[aria-label="Volgende week"]');
    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(2000);
    } else break;
  }

  const uniqueEvents = dedupe(allEvents);
  const ics = buildICS(uniqueEvents);
  fs.writeFileSync('rooster.ics', ics, 'utf8');

  console.log(`Saved ${uniqueEvents.length} events to rooster.ics`);
  await browser.close();
})();

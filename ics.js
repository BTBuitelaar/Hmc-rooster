// Minimal ICS builder
const pad = n => String(n).padStart(2,'0');
const toICSDate = dt => (
  dt.getFullYear() + pad(dt.getMonth()+1) + pad(dt.getDate()) +
  'T' + pad(dt.getHours()) + pad(dt.getMinutes()) + '00'
);

function buildICS(events, tz='Europe/Amsterdam'){
  const lines = [
    'BEGIN:VCALENDAR','VERSION:2.0','CALSCALE:GREGORIAN',
    'METHOD:PUBLISH','PRODID:-//HMC//Rooster Export//NL'
  ];
  for (const e of events) {
    const uid = `${+e.start}-${(e.title+'|'+(e.location||'')).replace(/\s+/g,'_')}@hmc`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `SUMMARY:${(e.title||'Les').replace(/\r?\n/g,' ')}`,
      `LOCATION:${e.location||''}`,
      `DTSTART;TZID=${tz}:${toICSDate(e.start)}`,
      `DTEND;TZID=${tz}:${toICSDate(e.end)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
module.exports = { buildICS };

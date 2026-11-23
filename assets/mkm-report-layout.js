const report = document.querySelector('#mkm-pages-editor [data-view]');
const menu = document.querySelector('#mkm-pages-editor [data-sections]');

function element(tag, className, value) {
 const node = document.createElement(tag);
 if (className) node.className = className;
 if (value) node.textContent = value;
 return node;
}

function placeCreative(table) {
 if (table.rows.length !== 2 || table.rows[1].cells.length !== 2) return;
 const [mediaCell, dataCell] = table.rows[1].cells;
 if (!mediaCell.querySelector('img, a[href$=".mp4"]')) return;
 const metrics = dataCell.textContent.trim().split(/\s+·\s+/).map(value => {
  const key = value.match(/^(구매매출|링크 클릭|링크 CTR|구매|CPA|ROAS|광고비)\s+/)?.[0];
  return key && [key.trim(), value.slice(key.length)];
 });
 if (metrics.length < 2 || metrics.some(metric => !metric || !metric[1])) return;
 const card = element('div', 'report-creative');
 const media = element('div', 'report-media');
 const figures = element('dl', 'report-kpis');
 media.append(...mediaCell.childNodes);
 for (const link of media.querySelectorAll('a[href$=".mp4"]')) link.classList.add('report-video-link');
 for (const [name, value] of metrics) {
  const item = element('div', ['구매', 'CPA', 'ROAS'].includes(name) ? 'report-kpi report-kpi-main' : 'report-kpi');
  item.append(element('dt', '', name), element('dd', '', value));
  figures.append(item);
 }
 card.append(media, figures);
 table.replaceWith(card);
}

if (report && menu) {
 const headings = Array.from(report.children).filter(node => node.tagName === 'H2');
 const title = report.querySelector(':scope > h1');
 if (title) {
  const hero = element('header', 'report-hero');
  title.before(hero);
  while (hero.nextElementSibling && hero.nextElementSibling.tagName !== 'H2') hero.append(hero.nextElementSibling);
  const [intro, details] = hero.querySelectorAll(':scope > p');
  intro?.classList.add('report-intro');
  if (details && /기여|기간|집계|출처/.test(details.textContent)) details.classList.add('report-context');
 }
 for (const heading of headings) {
  const short = heading.textContent.trim();
  if (short === '소재' && heading === headings.at(-1)) {
   const appendix = element('details', 'report-appendix');
   appendix.append(element('summary', '', '첨부 파일 모아보기'));
   while (heading.nextElementSibling) appendix.append(heading.nextElementSibling);
   heading.replaceWith(appendix);
   continue;
  }
  const section = element('section', 'report-section');
  section.id = heading.id || 'report-section-' + (menu.children.length + 1);
  heading.removeAttribute('id');
  const link = element('a', '', short.includes(' · ') ? short.split(' · ').at(-1) : short);
  link.href = '#' + encodeURIComponent(section.id);
  menu.append(link);
  heading.before(section);
  section.append(heading);
  while (section.nextElementSibling && section.nextElementSibling.tagName !== 'H2') section.append(section.nextElementSibling);
  for (const table of section.querySelectorAll('table')) placeCreative(table);
  for (const table of section.querySelectorAll('table')) {
   const wrap = element('div', 'report-table-scroll');
   table.before(wrap);
   wrap.append(table);
  }
 }
 menu.hidden = !menu.children.length;
}

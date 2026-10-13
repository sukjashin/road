// 관측 대상(노선·구간) 묶음 - index.html(상세)과 meeting.html(회의용)이 함께 쓴다.
// 메뉴를 미리 정해두지 않고, 자료에 적힌 target(관측 대상 이름)별로 묶어 메뉴를 만든다.
// target은 build-observations.cjs가 aws_1분/<관측 대상 이름>/ 폴더명에서 채우거나,
// 상세 화면에서 파일을 추가할 때 사용자가 직접 입력한다.

// "2025년 1월" · "2025년 1~2월" · "2024년 12월~2025년 2월"
function formatObservationPeriod(dates){
  const ym = dates.filter(Boolean).map(d => d.slice(0, 7)).sort();
  if(!ym.length) return '';
  const [y1, m1] = ym[0].split('-').map(Number);
  const [y2, m2] = ym[ym.length - 1].split('-').map(Number);
  if(y1 === y2 && m1 === m2) return `${y1}년 ${m1}월`;
  if(y1 === y2) return `${y1}년 ${m1}~${m2}월`;
  return `${y1}년 ${m1}월~${y2}년 ${m2}월`;
}

// files: [{ name, date, target, text }] -> [{ year, target, files, dates, period }] (첫 관측일 순)
// 같은 관측 대상이라도 연도가 다르면 따로 묶는다 (한 폴더에 여러 해 파일을 넣어도 연도별로 나뉨)
function groupObservationsByTarget(files){
  const groups = new Map();
  files.forEach(f => {
    const target = (f.target || '').trim() || '이름 없는 관측';
    const year = /^\d{4}/.test(f.date || '') ? f.date.slice(0, 4) : '연도 미상';
    const key = `${year}::${target}`;
    if(!groups.has(key)) groups.set(key, { year, target, files: [] });
    groups.get(key).files.push(f);
  });
  return Array.from(groups.values()).map(g => {
    g.files.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    g.dates = g.files.map(f => f.date).filter(Boolean);
    g.period = formatObservationPeriod(g.dates);
    return g;
  }).sort((a, b) => String(a.dates[0] || '').localeCompare(String(b.dates[0] || '')));
}

// 관측파일 첫 유효 행의 날짜(YYYY-MM-DD). 없으면 파일명 속 8자리 날짜를 쓴다
function detectObservationDate(name, text){
  const m = String(text).match(/^\s*(\d{4}-\d{2}-\d{2})\s+\d{1,2}:\d{2}/m);
  if(m) return m[1];
  const n = String(name).match(/(20\d{2})(\d{2})(\d{2})/);
  return n ? `${n[1]}-${n[2]}-${n[3]}` : '';
}

// ---- 다른 형식의 관측파일을 AWS 1분 자료 형식으로 바꾸기 ----
// 예) wdate_,temp_,r_temp_,humi_,alti_,longi_,lati_  (1초에 1~2건, 시각은 분 단위, 최신 행이 위)
// 분석 코드는 AWS 형식(#Time,Site,기온,…,위도 정수/소수,경도 정수/소수,…,노면온도,…)만 읽으므로,
// 머리글에 열 이름이 있는 파일은 여기서 같은 형식으로 바꿔 넣는다.
const COLUMN_ALIASES = {
  time: ['wdate_', 'wdate', 'time', 'datetime', '시간', '일시', '관측시각'],
  air: ['temp_', 'temp', 'airtemp', '기온'],
  road: ['r_temp_', 'r_temp', 'roadtemp', '노면온도'],
  humi: ['humi_', 'humi', 'humidity', '습도', '상대습도'],
  alt: ['alti_', 'alti', 'alt', 'altitude', '고도'],
  lat: ['lati_', 'lati', 'lat', 'latitude', '위도'],
  lon: ['longi_', 'longi', 'lon', 'lng', 'longitude', '경도'],
  friction: ['friction', '마찰계수']
};
const RESAMPLE_SEC = 10; // 초당 여러 건인 자료는 10초에 1건으로 줄인다(지도·위치 비교 계산량 제한, 약 150m 간격)

function normalizeObservationText(text){
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if(!lines.length || /^\d{4}-\d{2}-\d{2}/.test(lines[0])) return { text, converted: false };
  if(lines[0].startsWith('#')) return remapAwsColumns(lines, text);

  // "temp_","r_temp_" 처럼 따옴표로 감싼 csv도 읽는다
  const unquote = v => v.trim().replace(/^"(.*)"$/, '$1');
  const head = lines[0].split(',').map(h => unquote(h).toLowerCase().replace(/\(.*\)$/, ''));
  const col = {};
  Object.entries(COLUMN_ALIASES).forEach(([key, names]) => { col[key] = head.findIndex(h => names.includes(h)); });
  if(col.time < 0 || col.road < 0 || col.lat < 0 || col.lon < 0) return { text, converted: false };

  let rows = lines.slice(1).map(line => {
    const p = line.split(',').map(unquote);
    const m = (p[col.time] || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const num = key => col[key] >= 0 ? parseFloat(p[col[key]]) : NaN;
    if(!m) return null;
    const r = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] !== undefined ? +m[6] : null,
                air: num('air'), road: num('road'), humi: num('humi'), alt: num('alt'), lat: num('lat'), lon: num('lon'), friction: num('friction') };
    return isFinite(r.road) && isFinite(r.lat) && isFinite(r.lon) ? r : null;
  }).filter(Boolean);
  if(!rows.length) return { text, converted: false };

  const minuteKey = r => ((r.y * 100 + r.mo) * 100 + r.d) * 10000 + r.h * 100 + r.mi;
  // 최신 행이 위에 있는 파일은 시간순으로 뒤집는다
  if(minuteKey(rows[0]) > minuteKey(rows[rows.length - 1])) rows.reverse();
  // 초가 없으면 같은 분 안의 행들을 0~59초에 고르게 나눠 순서를 살린다
  let i = 0;
  while(i < rows.length){
    let j = i;
    while(j < rows.length && minuteKey(rows[j]) === minuteKey(rows[i])) j++;
    for(let k = i; k < j; k++) if(rows[k].s === null) rows[k].s = Math.floor((k - i) * 60 / (j - i));
    i = j;
  }
  const ms = r => new Date(r.y, r.mo - 1, r.d, r.h, r.mi, r.s).getTime();
  rows.sort((a, b) => ms(a) - ms(b));

  // RESAMPLE_SEC 구간마다 가운데 행 하나를 대표로 남긴다
  const buckets = new Map();
  rows.forEach(r => {
    const key = Math.floor(ms(r) / (RESAMPLE_SEC * 1000));
    if(!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  });
  const pad = n => String(n).padStart(2, '0');
  const val = v => isFinite(v) ? String(v) : '';
  const out = ['#Time,Site,기온(℃),상대습도(%),풍향(˚),풍속(m/s),강수량0.5(mm),기압(hPa),위도(정수),위도(실수),경도(정수),경도(실수),고도,방위각,노면온도,노면상태,마찰계수,수막,빙막두께,설막두께,결빙온도'];
  buckets.forEach(group => {
    const r = group[Math.floor(group.length / 2)];
    const latInt = Math.floor(r.lat), lonInt = Math.floor(r.lon);
    const cells = new Array(21).fill('');
    cells[0] = `${r.y}-${pad(r.mo)}-${pad(r.d)} ${pad(r.h)}:${pad(r.mi)}:${pad(r.s)}`;
    cells[1] = 'mobile';
    cells[2] = val(r.air); cells[3] = val(r.humi);
    cells[8] = String(latInt); cells[9] = String(Math.round((r.lat - latInt) * 10000));
    cells[10] = String(lonInt); cells[11] = String(Math.round((r.lon - lonInt) * 10000));
    cells[12] = val(r.alt); cells[14] = val(r.road); cells[16] = val(r.friction);
    // 반올림으로 소수부가 10000이 되면 정수부로 넘긴다
    if(cells[9] === '10000'){ cells[8] = String(latInt + 1); cells[9] = '0'; }
    if(cells[11] === '10000'){ cells[10] = String(lonInt + 1); cells[11] = '0'; }
    out.push(cells.join(','));
  });
  return { text: out.join('\n'), converted: true, sourceRows: rows.length, keptRows: out.length - 1 };
}

// AWS 파일(#Time,Site,…)인데 장비/버전에 따라 열 순서가 다르면 표준 위치(위도 8~9, 경도 10~11, 노면온도 14 …)로 옮긴다.
// 위도·경도·노면온도 열이 아예 없는 고정 관측소 자료는 그대로 두며, 이후 분석에서 유효 행 0건으로 걸러진다
const AWS_STANDARD = { '기온': 2, '상대습도': 3, '위도(정수)': 8, '위도(실수)': 9, '경도(정수)': 10, '경도(실수)': 11, '고도': 12, '노면온도': 14, '노면상태': 15, '마찰계수': 16, '결빙온도': 20 };
function remapAwsColumns(lines, text){
  const head = lines[0].replace(/^#/, '').split(',').map(h => h.trim().replace(/\(℃\)|\(%\)/g, ''));
  const from = {};
  Object.keys(AWS_STANDARD).forEach(name => { from[name] = head.indexOf(name); });
  const standard = Object.entries(AWS_STANDARD).every(([name, idx]) => from[name] === idx || from[name] < 0);
  if(standard || from['위도(정수)'] < 0 || from['노면온도'] < 0) return { text, converted: false };
  const out = [lines[0]];
  lines.slice(1).forEach(line => {
    const p = line.split(',');
    const cells = new Array(21).fill('');
    cells[0] = p[0]; cells[1] = p[1];
    Object.entries(AWS_STANDARD).forEach(([name, idx]) => { if(from[name] >= 0) cells[idx] = p[from[name]] ?? ''; });
    out.push(cells.join(','));
  });
  return { text: out.join('\n'), converted: true };
}

// ---- 엑셀(xlsx) 읽기 ----
// 외부 라이브러리 없이 zip 목록에서 시트 XML만 꺼내 csv 텍스트로 바꾼다.
// inflateRaw(Uint8Array) -> Promise<Uint8Array> 는 브라우저(DecompressionStream)와 Node(zlib)에서 각각 넣어준다
async function xlsxToCsv(buffer, inflateRaw){
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for(let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--){
    if(view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error('xlsx(zip) 형식이 아닙니다');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const entries = {};
  for(let n = 0; n < count; n++){
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true), extraLen = view.getUint16(ptr + 30, true), commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const name = utf8.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    entries[name] = { method, size, local };
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  async function read(name){
    const e = entries[name];
    if(!e) return '';
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    const raw = bytes.subarray(start, start + e.size);
    return utf8.decode(e.method === 0 ? raw : await inflateRaw(raw));
  }
  const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [];
  (await read('xl/sharedStrings.xml')).replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => {
    shared.push(unescapeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  });
  const colIndex = ref => ref.replace(/\d+/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const sheets = Object.keys(entries).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  const lines = [];
  let header = null;
  for(const sheet of sheets){
    const xml = await read(sheet);
    let first = true;
    xml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
      const cells = [];
      rowXml.replace(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (__, attrs, inner = '') => {
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/t="(\w+)"/) || [])[1];
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        let value = v === undefined ? '' : unescapeXml(v);
        if(type === 's') value = shared[Number(value)] ?? '';
        cells[ref ? colIndex(ref) : cells.length] = value;
      });
      const row = Array.from(cells, c => c ?? '');
      if(first){ // 시트마다 머리글 행이 있으므로 첫 시트 머리글만 쓴다
        first = false;
        if(!header){ header = row; lines.push(row.join(',')); }
        return;
      }
      lines.push(row.join(','));
    });
  }
  if(!header) return '';
  // 날짜 열은 엑셀 일련번호(1900 기준 일수)로 저장되므로 "YYYY-MM-DD HH:MM:SS"로 바꾼다
  const timeCol = header.findIndex(h => COLUMN_ALIASES.time.includes(String(h).trim().toLowerCase()));
  if(timeCol >= 0){
    const pad = n => String(n).padStart(2, '0');
    for(let i = 1; i < lines.length; i++){
      const p = lines[i].split(',');
      const serial = Number(p[timeCol]);
      if(!p[timeCol] || !isFinite(serial) || serial < 20000) continue;
      const d = new Date(Math.round((serial - 25569) * 86400) * 1000);
      p[timeCol] = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      lines[i] = p.join(',');
    }
  }
  return lines.join('\n');
}

// ---- 관측파일 묶음 -> 내장자료 항목 ----
// files: [{ name, target, data(ArrayBuffer|Uint8Array) }]
// 1) 같은 날 aws 파일이 있으면 real(초 단위 원시) 파일은 건너뜀 - 같은 주행을 두 번 세지 않기 위해
// 2) xlsx·다른 열 형식은 AWS 형식으로 변환
// 3) 누적 덤프처럼 같은 시각이 여러 파일에 있으면 한 번만 (큰 파일부터 채택)
// 4) 15분 넘게 끊기면 다른 주행으로 나눔 (일출전/일출후 등)
const TRIP_GAP_MIN = 15;
const MIN_TRIP_ROWS = 10;
async function prepareObservationEntries(files, inflateRaw){
  const skipped = [];
  const awsKeys = new Set(files.map(f => `${f.target}::${f.name.replace(/_aws_/i, '_@_')}`).filter(k => k.includes('_@_')));
  const parsed = [];
  for(const f of files){
    if(/_real_/i.test(f.name) && awsKeys.has(`${f.target}::${f.name.replace(/_real_/i, '_@_')}`)){
      skipped.push({ name: f.name, reason: '같은 날 aws 파일이 있어 건너뜀(real은 같은 주행의 초 단위 원시자료)' });
      continue;
    }
    let text;
    try {
      text = /\.xlsx$/i.test(f.name) ? await xlsxToCsv(f.data, inflateRaw) : decodeObservationBuffer(f.data);
    } catch(e){
      skipped.push({ name: f.name, reason: `읽기 실패: ${e.message}` });
      continue;
    }
    const norm = normalizeObservationText(text);
    const lines = norm.text.split(/\r?\n/).map(l => l.trim());
    const head = lines.find(l => l.startsWith('#')) || '';
    const data = lines.filter(l => /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(l) && isUsableAwsLine(l));
    if(!data.length){
      skipped.push({ name: f.name, reason: '위치·노면온도가 있는 관측 행이 없음(고정 관측소 자료이거나 지원하지 않는 형식)' });
      continue;
    }
    parsed.push({ file: f, head, data });
  }

  const entries = [];
  const byTarget = new Map();
  parsed.forEach(p => { if(!byTarget.has(p.file.target)) byTarget.set(p.file.target, []); byTarget.get(p.file.target).push(p); });
  byTarget.forEach((list, target) => {
    const seen = new Set();
    list.sort((a, b) => b.data.length - a.data.length);
    list.forEach(({ file, head, data }) => {
      const fresh = data.filter(l => {
        const [t, site] = l.split(',');
        const key = `${site}|${Math.floor(lineMs(t) / 10000)}`; // 10초 단위로 같은 시각 판정
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if(fresh.length < data.length && !fresh.length) skipped.push({ name: file.name, reason: '다른 파일과 시각이 모두 겹쳐(누적 덤프 등) 중복으로 제외' });
      // 지점(Site)별로 시간순 정렬 후 끊긴 곳에서 주행을 나눈다
      const bySite = new Map();
      fresh.forEach(l => { const site = l.split(',')[1]; if(!bySite.has(site)) bySite.set(site, []); bySite.get(site).push(l); });
      const trips = [];
      bySite.forEach(rows => {
        rows.sort((a, b) => lineMs(a.split(',')[0]) - lineMs(b.split(',')[0]));
        let cur = [];
        rows.forEach(l => {
          const ms = lineMs(l.split(',')[0]);
          if(cur.length && ms - lineMs(cur[cur.length - 1].split(',')[0]) > TRIP_GAP_MIN * 60000){ trips.push(cur); cur = []; }
          cur.push(l);
        });
        if(cur.length) trips.push(cur);
      });
      const kept = trips.filter(t => t.length >= MIN_TRIP_ROWS);
      const stem = file.name.replace(/\.[^.]+$/, '');
      kept.forEach((trip, i) => {
        entries.push({
          name: kept.length > 1 ? `${stem}_${i + 1}` : stem,
          date: trip[0].slice(0, 10),
          target,
          text: [head || '#Time,Site'].concat(trip).join('\n')
        });
      });
    });
  });
  return { entries, skipped };
}

function lineMs(t){
  const m = String(t).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : NaN;
}
// 분석 코드(parseStationLine)와 같은 최소 조건: 지점, 위·경도 정수/소수, 노면온도
function isUsableAwsLine(l){
  const p = l.split(',');
  return p.length >= 21 && (p[1] || '').trim() && /^\d{1,3}$/.test((p[8] || '').trim()) && /^\d{1,4}$/.test((p[9] || '').trim()) &&
    /^\d{1,3}$/.test((p[10] || '').trim()) && /^\d{1,4}$/.test((p[11] || '').trim()) && isFinite(parseFloat(p[14]));
}

// 업로드 파일 읽기: UTF-8이 아니면(엑셀 csv 등) EUC-KR로 읽는다
function decodeObservationBuffer(buf){
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch(e){ return new TextDecoder('euc-kr').decode(buf); }
}

if(typeof module !== 'undefined') module.exports = { formatObservationPeriod, groupObservationsByTarget, detectObservationDate, normalizeObservationText, decodeObservationBuffer, xlsxToCsv, prepareObservationEntries };

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

// files: [{ name, date, target, text }] -> [{ target, files, dates, period }] (첫 관측일 순)
function groupObservationsByTarget(files){
  const groups = new Map();
  files.forEach(f => {
    const target = (f.target || '').trim() || '이름 없는 관측';
    if(!groups.has(target)) groups.set(target, { target, files: [] });
    groups.get(target).files.push(f);
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

if(typeof module !== 'undefined') module.exports = { formatObservationPeriod, groupObservationsByTarget, detectObservationDate };

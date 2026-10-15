// 앱(PWA)용 서비스워커 - 인터넷이 약하거나 끊겨도 마지막으로 본 화면·자료가 열리도록 휴대폰에 저장해 둔다.
// · 우리 사이트 파일(화면·관측자료): 인터넷이 되면 항상 새로 받아(최신 자료 우선) 저장하고, 안 되면 저장본을 보여준다
// · 지도 라이브러리·글꼴(CDN): 버전이 고정된 파일이라 저장본을 먼저 쓴다
// · 지도 배경 타일: 너무 많아 저장하지 않는다(인터넷 필요)
const CACHE = 'road-icing-v1';
const CORE = [
  './',
  'index.html',
  'analysis.html',
  'dashboard.css',
  'road-observations.js',
  'observation-targets.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(url.origin === self.location.origin){
    event.respondWith(networkFirst(req));
  } else if(CDN_HOSTS.includes(url.hostname)){
    event.respondWith(cacheFirst(req));
  }
  // 그 밖(지도 타일·위성사진 등)은 브라우저 기본 동작
});

async function networkFirst(req){
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if(res.ok) cache.put(req, res.clone());
    return res;
  } catch(e){
    // "?v=해시"가 바뀐 자료 파일도 저장본으로 열리도록 쿼리 없이 한 번 더 찾는다
    return (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }
}

async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

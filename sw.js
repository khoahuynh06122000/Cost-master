/* Service worker cho app Kiểm kê F&B.
   Nguyên tắc: KHÔNG bao giờ cache dữ liệu Supabase (/sb/...) — số liệu phải luôn lấy mới,
   cache sai số là tai hại hơn nhiều so với việc load chậm vài giây.
   Chỉ cache phần vỏ app (index.html + icon) để mở nhanh và còn mở được khi mạng chập chờn. */
const CACHE = 'kiemke-fnb-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))   // thiếu 1 file cũng không chặn cài đặt
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // CDN, Teams webhook... để nguyên
  if (url.pathname.startsWith('/sb/')) return;          // dữ liệu Supabase: luôn đi thẳng ra mạng
  if (url.pathname.startsWith('/api/')) return;

  // Trang HTML: ưu tiên mạng để luôn có bản mới nhất, mất mạng thì lấy bản đã lưu
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put('/index.html', cp)); return r; })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  // Tài nguyên tĩnh (icon...): lấy cache trước cho nhanh, chưa có thì tải rồi lưu lại
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => hit))
  );
});

/* Thông báo đẩy: chỉ chạy khi đã dựng máy chủ gửi push (VAPID). Chưa có thì nhánh này nằm im. */
self.addEventListener('push', e => {
  let d = { title: 'Kiểm kê F&B', body: 'Có cập nhật mới' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch (err) { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'kiemke',
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});

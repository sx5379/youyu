/* The page's service worker. It is what lets a phone keep the page on its
   home screen, and open it with the last state it showed when there is no
   signal (the page then says how old that state is).

   NOTHING IS SERVED FROM HERE WHILE THE NETWORK ANSWERS. The page and its
   data are fetched from the network first, every time; the copies kept here
   are handed back only when the network does not answer. So a new version
   of the page, or a new push, is never hidden behind a cached one.

   What is kept: the page and its icons, and ONE copy of the newest status
   file (whichever of status.json and its per-minute and per-second copies
   answered last). The frames of a map are not kept. This file is public, like
   the page, so it names nobody.

   It also shows the alerts this device turned on (the page's Account view):
   a push arrives encrypted for this browser, the browser opens it, and it is
   shown as a notification at once. Every push is shown; a browser takes the
   subscription away from a page whose pushes show nothing. */
const SHELL = "status-shell-v1";
const DATA = "status-data-v1";
const SHELL_FILES = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png",
                     "icon-maskable-512.png", "apple-touch-icon.png"];
const LAST = "last-status";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(SHELL_FILES))
    .catch(() => {})                       // an icon that did not load is not a reason to stay out
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA)
                                  .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* the status file and its time-stamped copies, from GitHub or (served by
   the lab PC itself, or a test) from beside the page; not the frames (f/) */
const isStatus = url =>
  (url.hostname === "raw.githubusercontent.com" || url.origin === self.location.origin) &&
  (/\/status\.json$/.test(url.pathname) || /\/[ns]\/[^/]+\.json$/.test(url.pathname));

/* A WEAK SIGNAL IS NOT NO SIGNAL. A fetch that neither answers nor fails
   kept a phone opening the page from its home screen on a blank screen for
   tens of seconds, which is exactly when the kept copy is wanted. After
   WAIT_MS the kept copy is handed over if there is one; the network carries
   on regardless and refreshes it. With nothing kept, the network is awaited. */
const WAIT_MS = 3000;
function netFirst(req, keep, kept){
  const net = fetch(req).then(r => { keep(r); return r; });
  return new Promise(resolve => {
    let done = false;
    const give = r => { if(!done && r){ done = true; resolve(r); } };
    const t = setTimeout(() => kept().then(give, () => {}), WAIT_MS);
    net.then(r => { clearTimeout(t); give(r); },
             () => { clearTimeout(t);
                     kept().then(m => give(m || Response.error()),
                                 () => give(Response.error())); });
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch(err){ return; }

  if(isStatus(url)){
    e.respondWith(netFirst(req, r => {
      if(r.ok){
        const copy = r.clone();
        caches.open(DATA).then(c => c.put(LAST, copy)).catch(() => {});
      }
    }, () => caches.open(DATA).then(c => c.match(LAST))));
    return;
  }
  if(url.origin !== self.location.origin) return;

  const nav = req.mode === "navigate";
  const key = nav ? "./" : req;
  e.respondWith(netFirst(req, r => {
    if(r.ok && (nav || SHELL_FILES.some(f => f !== "./" && url.pathname.endsWith("/" + f)))){
      const copy = r.clone();
      caches.open(SHELL).then(c => c.put(key, copy)).catch(() => {});
    }
  }, () => caches.open(SHELL).then(c => c.match(key))));
});

/* AN ALERT: {title, body, tag, t, url}. A tag replaces the alert before it
   with the same tag (the page stopping, then updating again, is one alert
   that changes), and renotify makes the replacement sound again. */
self.addEventListener("push", e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; }
  catch(err){ m = {body: e.data ? e.data.text() : ""}; }
  const opts = {body: m.body || "", icon: "icon-192.png",
                data: {url: m.url || "./"},
                timestamp: m.t ? m.t * 1000 : Date.now()};
  if(m.tag){ opts.tag = m.tag; opts.renotify = true; }
  e.waitUntil(self.registration.showNotification(m.title || "Status", opts));
});

/* A tap opens the page: the window already showing it if there is one. */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./",
                      self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope) && "focus" in c);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});

// The service worker that shows eCourseFile's push notifications. The audit-requests Edge Function
// sends each notification through FCM as a data message, with title, body and link, the app's path
// that a tap opens. FCM wraps the data as { data: { ... } } in the push. A browser must show every
// push it gets, so this shows one even when the data is missing.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data?.json().data ?? {}
  } catch {
    // Not JSON, so show the default text.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'eCourseFile', {
      body: data.body || 'Open eCourseFile to see what changed.',
      data: { link: data.link || '/' },
    }),
  )
})

// A tap focuses a tab of the app that is open on the link's page, or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.link || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === url)
      return open ? open.focus() : self.clients.openWindow(url)
    }),
  )
})

# Hibira waiting room on Netlify

An [Edge Function](https://docs.netlify.com/edge-functions/overview/) that
puts a Hibira waiting room in front of `/drop`. Nothing else on your site
changes.

1. Copy `netlify/edge-functions/waiting-room.js` into your site and add the
   dependency: `npm install @hibira-io/waiting-room`.
2. Change `config.path` to the pages you want to protect.
3. In **Site configuration → Environment variables**, add `HIBIRA_KEY`,
   `HIBIRA_SECRET` and `HIBIRA_ROOM` (scope: Functions). They're on your app
   page at hibira.io. `HIBIRA_LANG` (for example `ja`) and
   `HIBIRA_PREVIOUS_SECRET` (during a secret rotation) are optional.
4. Create the room with the
   [waiting rooms API](https://github.com/hibira-io/pusher-server/blob/master/docs/waiting-rooms.md),
   with your site in `return_urls`, then deploy.

Test it locally with `netlify dev`: open `/drop` and you land on the queue
page.

中文摘要：把 `waiting-room.js` 放進 `netlify/edge-functions/`，在環境變數設定
`HIBIRA_KEY`、`HIBIRA_SECRET`、`HIBIRA_ROOM`，`/drop` 就會先經過 Hibira 排隊頁。

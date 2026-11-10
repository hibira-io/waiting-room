# Hibira waiting room on Amazon CloudFront

A [CloudFront Function](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html)
(viewer request, runtime `cloudfront-js-2.0`) that puts a Hibira waiting
room in front of one cache behavior, for example `/drop*`. It checks the
pass at the edge, so your origin never sees visitors who haven't been
admitted.

The app secret goes in a
[KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html),
not in the code.

## Set up

1. Create a KeyValueStore and add the key `hibira_secret` with your app
   secret (from your app page at hibira.io). During a secret rotation, add
   `hibira_previous_secret` too.
2. Create a function from `waiting-room.js`, runtime `cloudfront-js-2.0`.
   Associate the KeyValueStore with it. Fill in `KVS_ID` (the store's ID),
   `APP_KEY` and `ROOM`, and optionally `LANG`.
3. Publish the function. On the cache behavior for the protected path (for
   example `/drop*`), add it as a **Viewer request** function. Forward the
   `hibira_wr_<room>` cookie and the `hibira_pass` query string to the
   function. The cache policy can stay as it is: the function runs before
   the cache.
4. Create the room with the
   [waiting rooms API](https://github.com/hibira-io/pusher-server/blob/master/docs/waiting-rooms.md),
   with your site in `return_urls`.

Static files the page needs (CSS, JS, images) can live under another
behavior, so they load without a pass.

### Terraform

```hcl
resource "aws_cloudfront_key_value_store" "hibira" {
  name = "hibira-waiting-room"
}

resource "aws_cloudfrontkeyvaluestore_key" "secret" {
  key_value_store_arn = aws_cloudfront_key_value_store.hibira.arn
  key                 = "hibira_secret"
  value               = var.hibira_secret # keep it in a secret variable
}

resource "aws_cloudfront_function" "waiting_room" {
  name                         = "hibira-waiting-room"
  runtime                      = "cloudfront-js-2.0"
  publish                      = true
  key_value_store_associations = [aws_cloudfront_key_value_store.hibira.arn]
  code = replace(replace(file("${path.module}/waiting-room.js"),
    "REPLACE_WITH_KEY_VALUE_STORE_ID", aws_cloudfront_key_value_store.hibira.id),
    "REPLACE_WITH_APP_KEY", var.hibira_key)
}

# In the distribution's ordered_cache_behavior for "/drop*":
#   function_association {
#     event_type   = "viewer-request"
#     function_arn = aws_cloudfront_function.waiting_room.arn
#   }
```

To create the room in the same plan, use the `hibira_waiting_room` resource
in the Hibira Terraform provider.

## Notes

- The pass is checked with HMAC-SHA256 in the function. A pass is valid for
  30 minutes by default and works in any browser. If each queue number may
  check out once, record the ticket ID at checkout. Your origin can read it
  from the `hibira_wr_<room>` cookie, or ask
  `POST /apps/APP_ID/waiting_rooms/ROOM/verify`.
- Non-GET requests without a pass get a `403`.

中文摘要：CloudFront Function（viewer request）在邊緣驗證等候室 pass。app
secret 放在 KeyValueStore 的 `hibira_secret`，填入 `KVS_ID`、`APP_KEY`、`ROOM`
後掛到要保護的 cache behavior 即可。沒有 pass 的訪客會被導到 Hibira 排隊頁。

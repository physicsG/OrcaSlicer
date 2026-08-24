# Snapmaker cloud API

Cloud-connected devices are reached through Snapmaker's REST API rather than a LAN broker.
The Device page uses `dio` for these calls; the printer protocol itself is unchanged —
the cloud path only supplies credentials and file transfer.

## Hosts

| Environment | Host |
|---|---|
| Production (global) | `https://api.snapmaker.com/api` |
| Production (China) | `https://api.snapmaker.cn/api` |
| Identity | `https://id.snapmaker.com/api` |
| Pre-production | `https://pre.api.snapmaker.com/api`, `https://pre.api.snapmaker.cn/api`, `https://pre.id.snapmaker.com/api` |
| **Internal dev (left in the shipping bundle)** | `http://172.17.100.32:8100/api` |

The `.com` / `.cn` split is region selection; `get_international_url()` on the Orca side
rewrites the loopback URL to match the user's region before the webview loads it.

## Authentication

OAuth2 against the identity host:

```
POST /oauth2/token
```

with `client_id`, `grant_type`, `scope`; the reply carries `access_token`, `token_type`
(`bearer`), and is sent onward as `Authorization: Bearer <token>`.

Token expiry surfaces to the UI as `TokenInvalidationEvent{uri, accessToken, msg, code, desc}`.
The session user is `User{nickname, userid, email, account, status, icon, token, cellphone}`.

Orca persists the login across restarts — see `SMAccountPersist.hpp` and the
`sw_GetUserLoginState` / `sw_SubscribeUserLoginState` bridge commands.

## Device binding

| Endpoint | Purpose |
|---|---|
| `POST /user/device/bind` | Bind a printer to the account |
| `POST /user/device/unbind` | Release it |
| `GET /user/device/list` | Bound devices |
| `GET /user/device/info` | One device's detail |
| `POST /user/device/checkAuth` | Check current authorisation |
| `POST /user/device/connect/auth` | Authorise a connection attempt |
| `GET /user/device/getMqttCert` | **Fetch the mTLS material** — becomes `DeviceCertConfig` |

`getMqttCert` is the cloud counterpart of the LAN `server.request_key` handshake: both
end with `{ca, cert, key, port, clientId}` and a topic namespace, after which the
transport is identical.

## File upload

A three-step create/complete/cancel flow, consistent with pre-signed object storage:

| Endpoint | Purpose |
|---|---|
| `POST /user/device/upload/create` | Begin an upload, obtain the destination |
| `POST /user/device/upload/completed` | Finalise |
| `POST /user/device/upload/cancel` | Abort |

`index.html` allows the `x-amz-checksum-sha256` request header, so the destination is
S3-compatible and the client checksums with SHA-256. `UploadTaskState` carries a
`checksum` field, and `DirectPrintParams` carries `fileChecksum`.

Once uploaded, `server.files.pull` tells the printer to fetch the object itself, with
progress reported back over `<SN>/notification` as `notify_file_pull_progress`.
`server.files.start_cloud_print` then starts the job.

## Model library

`/model/list`, `/model/detail/`, `/manage/model/list`, `/manage/model/detail/` and their
`/cn/` variants back the model-library browsing surface.

## Legacy HTTP printer path

Strings for a plain Moonraker HTTP host also survive — `/server/info`,
`/server/files/upload`, `/server/files/gcodes/`, `/status`, `/status/poll`, `/health`,
`/ping`, `/preUpload`, `/preUploadAndPrint`. These belong to the non-U1 printer path
(`?path=3`), where `PrinterWebView::SendAPIKey()` injects `X-API-Key` into `fetch` and
`XMLHttpRequest`. The U1 does not use them.

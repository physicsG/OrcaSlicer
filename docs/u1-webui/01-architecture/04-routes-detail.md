# Routes and screens

## One bundle, many entry points

The same `main.dart.js` backs every Snapmaker web surface in Orca. The `path` query
parameter selects which, resolved by the dispatcher `bFQ()` into an **`AppModule`** enum:

```js
bFQ(a){ var s = a.replace("/","")
  if (s==="")                                 return unknown
  else if (s==="1" || s==="home")             return home
  else if (s==="2" || s==="deviceControl")    return deviceControl
  else if (s==="3" || s==="deviceControlOld") return deviceControlOld
  else if (s==="4" || s==="preUploadAndPrint")return preUploadAndPrint
  else if (s==="5" || s==="preUpload")        return preUpload
  else if (s==="6" || s==="testPrintUploadTask") return testPrintUploadTask
  else if (s==="7" || s==="testDownloadFile") return testDownloadFile
  return home }                               // fallback
```

Every module accepts **either a number or its alias** — `?path=2` and `?path=deviceControl`
are the same route.

| `path=` | Module | Enum ordinal | Loaded by |
|---|---|---:|---|
| *(unmatched)* | `home` *(fallback)* | 1 | — |
| `""` | `unknown` | 0 | — |
| `1` / `home` | `home` | 1 | `WebViewDialog.cpp` (commented-out line) |
| **`2` / `deviceControl`** | **`deviceControl`** | **2** | **`PrinterWebView.cpp`** |
| `3` / `deviceControlOld` | `deviceControlOld` | 3 | `Plater.cpp` for non-U1 print hosts |
| `4` / `preUploadAndPrint` | `preUploadAndPrint` | **5** | `WebPreprintDialog.cpp` (`m_prePrint_url`) |
| `5` / `preUpload` | `preUpload` | **4** | `WebPreprintDialog.cpp` (`m_preSend_url`) |
| `6` / `testPrintUploadTask` | `testPrintUploadTask` | 6 | — |
| `7` / `testDownloadFile` | `testDownloadFile` | 7 | — |

### Two traps

**`path=0` and `path=discovery` are not in the table.** `WebViewDialog.cpp:40` loads
`?path=0` and `WebDeviceDialog.cpp:20` loads `?path=discovery`; neither string matches any
branch, so both fall through to the `home` fallback. The net effect for `path=0` is the
home screen either way, but discovery does *not* reach a discovery module by this route.

**URL numbers 4 and 5 map to swapped enum ordinals** — URL `4` (`preUploadAndPrint`) is
ordinal 5, and URL `5` (`preUpload`) is ordinal 4. This matters because the page builder
`ckp()` switches on the *ordinal*, not the URL parameter:

```js
case 4: return new PreUploadPage(filename, isPrint ?? false)  // preUpload
case 5: return new PreUploadPage(filename, isPrint ?? true)   // preUploadAndPrint
```

Read against the URL the defaults look inverted; read against the ordinal they are correct
— "and print" defaults `isPrint` to true. Both modules also accept `filename` and
`isPrint` query parameters alongside `path`.

### Module-gated behaviour

`ckp()` sets two flags from the resolved module, so some subsystems behave differently
outside the Device page:

```js
$.eN.ch          = moduleName !== "deviceControl"
$.b3().gca().ch  = module     !== AppModule.deviceControl
```

## The developer route menu

The bundle still contains a developer landing screen. It renders "Welcome to Snapmaker
Orca", the version and build number, and one button per route — twelve `ElevatedButton`s
wired to the closures that push `/home`, `/deviceControl`, `/deviceControlOld`,
`/preUploadAndPrint`, `/preUpload`, `/testPrintUploadTask` and others.

It is a genuine debug affordance left in a shipping build, and combined with
unconditionally-enabled DevTools it is the fastest way to reach any screen by hand.

## Connection state machine

The seven `assets/images/device*.webp` illustrations enumerate the states the Device page
can show before it has a live printer:

| Asset | State |
|---|---|
| `deviceNotConnected.webp` | No device selected/connected |
| `deviceAuthorizing.webp` | Pairing in progress — awaiting approval on the printer |
| `deviceAuthorized.webp` | Pairing accepted |
| `deviceRejected.webp` | Pairing refused at the printer |
| `deviceNoNetwork.webp` | Client has no network |
| `deviceNoResponse.webp` | Reachable but not answering |
| `deviceInvalidVersion.webp` | Firmware too old for this client |
| `deviceExceptionMessage.webp` | Fault banner |
| `deviceDisplayDefault.webp` | Placeholder |

These line up with the pairing handshake in [MQTT transport](../05-printer-protocol/03-mqtt-transport.md):
`deviceAuthorizing` is the window between publishing `server.request_key` and the
`state: "success"` reply, and `deviceRejected` is a non-success reply.

`IpInputGuide.webp` / `ipInputGuideCN.webp` back the manual-IP fallback, matching the
i18n keys `input_ip_address`, `discovery_tip1`, `discovery_tip2`, `Manual connect`.

## Device page feature set

The `assets/svgs/device/` icon set is a compact inventory of what the Device page offers:

| Group | Icons |
|---|---|
| Print control | `iconControlPlay`, `iconControlPause`, `iconControlStop`, `play`, `pause`, `stop` |
| Temperature | `iconHotBedTemperature`, `iconExtruderHead`, `extruderBackground` |
| Fans / air | `iconFan`, `iconAuxiliaryCooling`, `iconMainCooling` |
| Lighting | `iconLed` |
| Motion | `deviceActionHome`, `iconHome` |
| Speed | `iconSpeed` |
| Filament | `iconFilamentCheck`, `iconFilamentEdit` |
| Chamber | `iconTopCover`, `iconTopCoverInner`, `iconTopCoverOuter`, `iconTopCoverOn`, `iconTopCoverOff` |
| Files | `iconFile`, `iconModelFileFolder`, `exportFile` |
| Camera | `liveCamera`, `videoCall`, `videoPlay`, `iconTimeLapse` |
| Device mgmt | `addDevice`, `iconBind`, `iconEdit`, `delete`, `logout`, `firmwareUpdate`, `wifi`, `iconScan`, `iconSearch` |
| Settings | `settings`, `iconMoreSetting`, `instructions` |

`assets/svgs/extruder/iconExtruder{1,2,3,4}.svg` confirms the four-toolhead layout.

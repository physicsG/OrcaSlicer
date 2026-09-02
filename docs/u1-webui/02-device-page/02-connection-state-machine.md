# Device connection state machine

The page models connection with several distinct enums rather than one. All of
them are recovered verbatim from the dart2js constant pool by
[`tools/extract_enums.py`](../tools/extract_enums.py) — the value *names* and
*indices* are the real Dart declarations, not reconstructions.

## How they relate

```
ConnectionStatus      the live transport state, driven by the MQTT/LAN session
        |             (unknown -> connecting -> connectedOnline)
        v
DeviceStatusType      what the UI displays, folding in every failure mode
        |             (authorized, rejected, noNetwork, offline, unbound, ...)
        v
DeviceStatus          what the machine itself is doing, once reachable
                      (idle, working, bedLeveling, autoLoading, ...)
```

`DeviceConnectStatus` and `DeviceConnectionError` describe the pairing attempt
in progress; `DeviceConnectionChannel` and `ConnectionChannel` name the transport
(LAN vs cloud).

### `DeviceStatusType`

26 values — minified `A.dS`. The status the UI renders. Each value has a matching illustration or message; `assets/images/device*.webp` covers the visual ones.

| Idx | Value |
|---|---|
| 0 | `unknown` |
| 1 | `notAvailable` |
| 2 | `authorizing` |
| 3 | `authorizeTimeout` |
| 4 | `authorized` |
| 5 | `rejected` |
| 6 | `lanNotSupported` |
| 7 | `deviceVersionCheckUpdate` |
| 8 | `deviceVersionCheckUpdateFailed` |
| 9 | `noNetwork` |
| 10 | `networkTimeout` |
| 11 | `serverNotReachable` |
| 12 | `networkDisconnected` |
| 13 | `downloadModelFileFailed` |
| 14 | `uploadModelFileFailed` |
| 15 | `offline` |
| 16 | `disconnected` |
| 17 | `modeNotAvailable` |
| 18 | `unbound` |
| 19 | `deviceBusinessHeartbeatException` |
| 20 | `authCheckException` |
| 21 | `authCodeLocaleNotMatch` |
| 22 | `cannotGetConnectedMachineInfo` |
| 23 | `deviceConnectFailed` |
| 24 | `deviceAuthorizationRemoved` |
| 25 | `deviceExceptionMessage` |

### `DeviceStatus`

15 values — minified `A.jx`. What the machine is doing. Ten of the fifteen values are calibration or filament-handling states, which is what a four-toolhead machine spends its non-printing time on.

| Idx | Value |
|---|---|
| 0 | `idle` |
| 1 | `working` |
| 2 | `xyzCalibrating` |
| 3 | `bedLeveling` |
| 4 | `flowCalibrating` |
| 5 | `vibrationCalibrating` |
| 6 | `upgrading` |
| 7 | `error` |
| 8 | `manualSpringScrewAdjusting` |
| 9 | `autoLoading` |
| 10 | `autoUnloading` |
| 11 | `manualLoading` |
| 12 | `dockingCoordinateCalibrating` |
| 13 | `homeOriginCalibrating` |
| 14 | `offline` |

### `ConnectionStatus`

7 values — minified `A.n8`

| Idx | Value |
|---|---|
| 0 | `unknown` |
| 1 | `connecting` |
| 2 | `connected` |
| 3 | `connectedOffline` |
| 4 | `connectedOnline` |
| 5 | `disconnected` |
| 6 | `discontinue` |

### `DeviceConnectStatus`

10 values — minified `A.jU`

| Idx | Value |
|---|---|
| 0 | `unknown` |
| 1 | `disconnected` |
| 2 | `connecting` |
| 3 | `authorizing` |
| 4 | `authorized` |
| 5 | `rejected` |
| 6 | `connected` |
| 7 | `connectionFailed` |
| 8 | `authorizationFailed` |
| 9 | `disconnecting` |

### `DeviceConnectionError`

9 values — minified `A.m3`

| Idx | Value |
|---|---|
| 0 | `none` |
| 1 | `internalError` |
| 2 | `paramsError` |
| 3 | `connectionFailed` |
| 4 | `authorizationFailed` |
| 5 | `timeout` |
| 6 | `networkError` |
| 7 | `certificateError` |
| 8 | `deviceRejected` |

### `DeviceConnectionChannel`

4 values — minified `A.EN`

| Idx | Value |
|---|---|
| 0 | `unknown` |
| 1 | `cloud` |
| 2 | `lan` |
| 5 | `wcp` |

### `DeviceConnectionTask`

6 values — minified `A.q2`

| Idx | Value |
|---|---|
| 0 | `getPrinterObjectList` |
| 1 | `subscribePrinterObjects` |
| 2 | `setSubscribeFilter` |
| 3 | `queryPrinterStatus` |
| 4 | `updateDeviceInfo` |
| 5 | `updateDeviceSystemInfo` |

### `DeviceDisplayStatus`

5 values — minified `A.zH`

| Idx | Value |
|---|---|
| 0 | `online` |
| 1 | `weakConnection` |
| 2 | `offline` |
| 3 | `connecting` |
| 4 | `unknown` |

## Observed transition

From a live harness boot, with a simulated host and a stubbed cloud API:

```
[LavaDeviceVM] getDeviceDisplayStatus: sn=, connectionStatus=ConnectionStatus.unknown
WcpConnection, _observeClientStatus, isResponding: true, status: ConnectionStatus.connecting
[LavaDeviceVM] getDeviceDisplayStatus: sn=U1SIM0000000001, connectionStatus=ConnectionStatus.connectedOnline
```

The serial number appears only once the device is resolved; `getDeviceDisplayStatus`
is called with an empty `sn` on the first pass and is the function that maps
`ConnectionStatus` onto a `DeviceStatusType` for display.


# APPS Bridge Universal Bridge Developer Guide

This document is the implementation reference for building Even Hub apps that
use APPS Bridge on Android.

APPS Bridge lets a glasses app request phone data from the Android companion
without uploading a native Android module. The glasses app sends declarative
JSON over a local WebSocket. The Android companion owns Android permissions,
starts only the requested data sources, streams data while the app is connected,
and releases resources when the app disconnects or goes inactive.

Every app should send a human-readable `name`. APPS Bridge shows that name in
the Android app and in the persistent Android notification while the app is
connected.

## What The Bridge Can Do

APPS Bridge can:

1. Start and stop a local WebSocket server on `127.0.0.1:7071`.
2. Let apps request phone components with JSON: `gps`, `media`, `nav`, `http`,
   `captions`, `phone_audio`, and `sensors`.
3. Activate GPS only when requested by a connected app.
4. Stream GPS latitude, longitude, speed, heading, and accuracy.
5. Read active Android media session metadata and playback state.
6. Send media controls to the phone: play, pause, next, previous.
7. Read supported navigation notifications and parse instruction, distance,
   ETA, and active route state.
8. Expose HTTP JSON endpoints and Server-Sent Events when `http` is requested.
9. Discover all Android sensors available on the phone.
10. Stream requested Android SensorManager events to the requesting WebSocket.
11. Report missing sensors and missing Android permissions per request.
12. Start/stop Android playback-audio capture for caption workflows.
13. Stream phone audio as base64 PCM frames for caption workflows.
14. Broadcast caption status, partial text, final text, and errors.
15. Manage per-client lifecycle through hello, heartbeat, goodbye, timeout,
   socket close, and bridge sleep.

APPS Bridge does not provide general remote control of the phone. The control
surface currently exposed to web pages is media playback control plus the phone
audio capture permission flow.

## User Setup Requirements

The user must open APPS Bridge once after install, update, or phone restart and
turn the bridge on. After that, glasses apps can connect to the local bridge and
request the data they need.

The user controls Android permissions in APPS Bridge:

```text
Location              -> gps
Media and navigation  -> media, nav, http media controls, nav debug
Phone sensors         -> ACTIVITY_RECOGNITION and BODY_SENSORS when needed
Background use        -> keeps the bridge available after leaving the app
Record audio          -> phone_audio capture, requested only when used
```

If a permission is not granted, the related data source either stays inactive or
reports an unavailable/permission-required state.

## Local Transports

WebSocket:

```text
ws://127.0.0.1:7071
```

HTTP and Server-Sent Events:

```text
http://127.0.0.1:7070
```

Both bind to `127.0.0.1`. They are intended for code running on the same Android
device, such as an Even Hub WebView.

The HTTP server is started only when the active component union includes
`http`. WebSocket is the primary bridge transport.

## Starting The Bridge From A WebView

If APPS Bridge was turned on after install/restart, apps can connect directly.
If an app needs to ask Android to wake the bridge service from a WebView, it can
launch this intent URL:

```text
intent://#Intent;action=cc.homeauto.appsbridge.START_BRIDGE;package=cc.homeauto.appsbridge;end
```

That opens a transparent activity, starts the foreground bridge service, and
finishes immediately. Android may still require the user to have opened APPS
Bridge once after install/update/restart.

## Lifecycle Model

1. The Android app starts the bridge service.
2. The service starts the WebSocket server on `127.0.0.1:7071`.
3. No expensive components are active while idle.
4. A glasses app opens the WebSocket.
5. The bridge sends an immediate snapshot frame for `gps`, `media`, `nav`, and
   `cc_status`.
6. The app sends `client_hello` with `name` and requested `components`.
7. The bridge activates the union of all connected clients' components.
8. The bridge keeps the foreground notification updated with the connected app
   name.
9. The app should send `client_heartbeat` periodically if it uses managed
   lifecycle.
10. The app releases resources by sending `client_goodbye`, `sensor_stop`, or by
   closing the socket.
11. If managed lifecycle heartbeats stop for about 45 seconds, the bridge clears
   that client's requested components.
12. When no components are requested, the bridge sleeps after about 20 seconds.

Keepalive details:

```text
WebSocket ping interval:        about 30 seconds
WebSocket lost timeout:         about 10 seconds
Managed client stale timeout:   about 45 seconds
No-component sleep delay:       about 20 seconds
GPS first-fix retry window:     about 10 seconds
```

## Component Reference

Declare components in the `components` array.

```text
gps
  Starts Android GPS_PROVIDER updates.
  Streams speed in meters per second, heading in degrees, lat, lng, accuracy.
  Uses about 500 ms / 0.5 m location update criteria.

media
  Reads the active Android media session.
  Streams title, artist, and status.
  Requires notification listener/media access.

nav
  Scans active navigation notifications.
  Supports Google Maps, Waze, OsmAnd, OsmAnd+, and Sygic package names.
  Streams parsed instruction, distance, eta, active state, and optional icon.

http
  Starts the local HTTP server on 127.0.0.1:7070.
  Enables REST JSON, SSE, nav debug, and media command endpoints.

captions
  Marks caption workflow active and exposes caption status frames.

phone_audio
  Marks phone audio capture requested.
  Actual capture starts through `cc_command` and Android permission flow.

sensors
  Starts Android SensorManager streams declared in `sensors` or
  `sensorRequests`.
```

Component names are normalized by lowercasing and replacing hyphens with
underscores. For example, `phone-audio` becomes `phone_audio`.

## Client Identity

Use these fields in `client_hello`:

```json
{
  "type": "client_hello",
  "app": "com.example.ridehud",
  "name": "Ride HUD",
  "components": ["gps", "media", "nav"],
  "managedLifecycle": true
}
```

Field reference:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `type` | yes | string | `client_hello`. |
| `app` | recommended | string | Stable internal id. Alias: `module`. |
| `module` | no | string | Legacy alias for `app`. |
| `name` | yes | string | User-visible app name shown in app/notification. |
| `components` | yes for new apps | string array | Requested bridge components. |
| `active` | no | boolean | Defaults to `true`. If `false`, request is inactive. |
| `managedLifecycle` | recommended | boolean | Enables heartbeat timeout cleanup. |
| `sensors` | when using sensors | array | Sensor request declarations. |
| `sensorRequests` | no | array | Alias for `sensors`. |

Legacy compatibility:

```text
module/app = motohud  -> gps, media, nav, http
module/app = live_cc  -> captions
```

New apps should always send explicit `components`.

## WebSocket Message Reference

Messages the app sends to APPS Bridge:

```text
client_hello       Identify app and request components.
client_heartbeat   Keep managed lifecycle alive and optionally update components.
client_goodbye     Mark this client inactive and release requested components.
sensor_list        Ask which Android sensors this phone exposes.
sensor_snapshot    Get latest sensor values for this WebSocket client.
sensor_stop        Stop sensors for this WebSocket client.
cc_state           Report caption UI capture state.
cc_command         Start or stop phone-audio capture.
```

Frames APPS Bridge can send:

```text
gps                GPS data snapshot/event.
media              Media data snapshot/event.
nav                Navigation data snapshot/event.
cc_status          Caption/capture status.
caption_partial    Partial caption text.
caption_final      Final caption text.
cc_audio           Base64 PCM audio frame for captioning.
cc_error           Caption/audio error.
sensor_status      Sensor activation/deactivation status.
sensor_response    Response to sensor_list, sensor_snapshot, sensor_stop.
sensor_event       Live Android sensor event.
```

## WebSocket: client_hello

Basic phone-data request:

```json
{
  "type": "client_hello",
  "app": "com.example.ridehud",
  "name": "Ride HUD",
  "components": ["gps", "media", "nav", "http"],
  "managedLifecycle": true
}
```

Sensor request:

```json
{
  "type": "client_hello",
  "app": "com.example.sensorhud",
  "name": "Sensor HUD",
  "components": ["sensors"],
  "managedLifecycle": true,
  "sensors": [
    { "id": "motion", "sensor": "accelerometer", "rateMs": 100 },
    { "id": "gyro", "sensor": "gyroscope", "rateMs": 100 },
    { "id": "lux", "sensor": "light", "rateMs": 500 }
  ]
}
```

All-in request:

```json
{
  "type": "client_hello",
  "app": "com.example.devprobe",
  "name": "Developer Probe",
  "components": ["gps", "media", "nav", "http", "sensors"],
  "managedLifecycle": true,
  "sensors": ["accelerometer", "gyroscope", "rotation_vector", "light"]
}
```

## WebSocket: client_heartbeat

Use heartbeats if `managedLifecycle` is true.

```json
{
  "type": "client_heartbeat",
  "active": true,
  "components": ["gps", "media", "nav", "sensors"]
}
```

Heartbeat notes:

1. Send roughly every 15 seconds.
2. If `active` is false, the bridge releases this client's components.
3. If `components` is present, it replaces this client's component request.
4. If `components` is omitted, the existing component request is kept.
5. If `sensors` or `sensorRequests` is present, it replaces the active sensor
   declarations for this socket.

## WebSocket: client_goodbye

Release this client's requested components:

```json
{
  "type": "client_goodbye",
  "active": false
}
```

Closing the WebSocket also releases client-specific sensor registrations and
requested components.

## GPS Frames

Request:

```json
{
  "type": "client_hello",
  "app": "com.example.ridehud",
  "name": "Ride HUD",
  "components": ["gps"],
  "managedLifecycle": true
}
```

Frame:

```json
{
  "type": "gps",
  "data": {
    "speed": 12.4,
    "heading": 90.0,
    "lat": 35.12345,
    "lng": -80.12345,
    "accuracy": 6.0
  }
}
```

GPS fields:

| Field | Type | Notes |
| --- | --- | --- |
| `speed` | number | Meters per second from Android `Location.speed`. |
| `heading` | number or null | Degrees, only when Android reports bearing. |
| `lat` | number or null | Latitude. |
| `lng` | number or null | Longitude. |
| `accuracy` | number or null | Accuracy in meters. |

APPS Bridge does not smooth, clamp, or rewrite GPS speed. Consumers should apply
their own display smoothing if needed.

## Media Frames

Request:

```json
{
  "type": "client_hello",
  "app": "com.example.musicview",
  "name": "Music View",
  "components": ["media"],
  "managedLifecycle": true
}
```

Frame:

```json
{
  "type": "media",
  "data": {
    "title": "Song title",
    "artist": "Artist",
    "status": "playing"
  }
}
```

Media fields:

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Current media title or empty string. |
| `artist` | string | Current artist or empty string. |
| `status` | string | `playing`, `paused`, or `unknown`. |

Media data comes from Android media sessions through the notification listener.

## Navigation Frames

Request:

```json
{
  "type": "client_hello",
  "app": "com.example.navhud",
  "name": "Navigation HUD",
  "components": ["nav"],
  "managedLifecycle": true
}
```

Frame:

```json
{
  "type": "nav",
  "data": {
    "instruction": "Turn right onto Main St",
    "distance": "500 ft",
    "eta": "Arrive 12:45",
    "active": true,
    "iconType": "turn-right",
    "icon": "base64-png-if-available"
  }
}
```

Navigation fields:

| Field | Type | Notes |
| --- | --- | --- |
| `instruction` | string | Parsed turn instruction or status text. |
| `distance` | string | Parsed distance, if available. |
| `eta` | string | Parsed arrival time, if available. |
| `active` | boolean | True when an active route is detected. |
| `iconType` | string | Optional resolved turn type. Present only when resolved. |
| `icon` | string | Optional base64 PNG data for the resolved icon. |

Supported navigation notification packages:

```text
com.google.android.apps.maps
com.waze
net.osmand
net.osmand.plus
com.sygic.aura
```

Navigation parsing scans notification title, text, big text, subtext, info text,
and ticker. `/debug/nav` exposes the raw fields used for troubleshooting.

## Android Sensors Overview

Request sensors by adding `sensors` to `components` and declaring `sensors` or
`sensorRequests`.

Supported declarative keys:

```text
accelerometer
accelerometer_uncalibrated
ambient_temperature
device_private_base
game_rotation_vector
geomagnetic_rotation_vector
gravity
gyroscope
gyroscope_uncalibrated
heart_beat
heart_rate
light
linear_acceleration
low_latency_offbody_detect
magnetic_field
magnetic_field_uncalibrated
motion_detect
pose_6dof
pressure
proximity
relative_humidity
rotation_vector
significant_motion
stationary_detect
step_counter
step_detector
```

The actual list varies by phone. Always use `sensor_list` for the current
device.

Sensor names are normalized this way:

```text
Sensor.TYPE_ACCELEROMETER -> accelerometer
TYPE_GYROSCOPE           -> gyroscope
game-rotation-vector     -> game_rotation_vector
game rotation vector     -> game_rotation_vector
```

Unknown numeric Android sensor types can be requested with `sensorType`.

## WebSocket: sensor_list

Request:

```json
{
  "type": "sensor_list",
  "requestId": "sensors-1"
}
```

Response:

```json
{
  "type": "sensor_response",
  "action": "sensor_list",
  "ok": true,
  "requestId": "sensors-1",
  "data": {
    "schema": "cc.homeauto.appsbridge.sensors.v1",
    "handshakeField": "sensors",
    "availableSensors": [
      {
        "type": 1,
        "key": "accelerometer",
        "name": "BMI160 Accelerometer",
        "vendor": "Bosch",
        "version": 1,
        "maximumRange": 39.2,
        "resolution": 0.01,
        "minDelayMicros": 5000,
        "powerMa": 0.18,
        "permission": null,
        "permissionGranted": true
      }
    ],
    "timestamp": 1760000000000
  },
  "timestamp": 1760000000000
}
```

Sensor list fields:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | number | Android Sensor type integer. |
| `key` | string | APPS Bridge declarative key. |
| `name` | string | Android sensor display name. |
| `vendor` | string | Android sensor vendor. |
| `version` | number | Android sensor version. |
| `maximumRange` | number | Sensor maximum range. |
| `resolution` | number | Sensor resolution. |
| `minDelayMicros` | number | Android minimum reporting delay in microseconds. |
| `powerMa` | number | Android reported power draw in mA. |
| `permission` | string or null | Runtime permission required by this sensor, if any. |
| `permissionGranted` | boolean | Whether APPS Bridge currently has that permission. |

## Sensor Request Shapes

Object form:

```json
{
  "id": "motion",
  "sensor": "accelerometer",
  "rateMs": 100
}
```

Accepted object fields:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `id` | no | string | Source id returned as `source`. Defaults to sensor key. |
| `name` | no | string | Fallback source id when `id` is missing. |
| `sensor` | yes | string/number | Sensor key or Android sensor type. |
| `key` | no | string/number | Alias for `sensor`. |
| `type` | no | string/number | Alias for `sensor`. |
| `sensorType` | no | string/number | Android sensor type or key. |
| `rateMs` | no | number | Requested reporting interval in ms. |

`rateMs` is clamped to this range:

```text
minimum: 20 ms
maximum: 60000 ms
default: 250 ms
```

`id` rules:

```text
Must match: ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
Duplicate ids are made unique by appending _2, _3, ...
```

String form:

```json
{
  "type": "client_hello",
  "app": "simple_motion",
  "name": "Simple Motion",
  "components": ["sensors"],
  "sensors": ["accelerometer", "gyroscope"]
}
```

All sensors:

```json
{
  "type": "client_hello",
  "app": "sensor_dump",
  "name": "Sensor Dump",
  "components": ["sensors"],
  "sensors": ["all"]
}
```

Object-form all sensors with a rate:

```json
{
  "type": "client_hello",
  "app": "sensor_dump",
  "name": "Sensor Dump",
  "components": ["sensors"],
  "sensors": [
    { "sensor": "all", "rateMs": 1000 }
  ]
}
```

Use `all` carefully. It can generate a large event volume and increase battery
use.

## Sensor Permissions

Most motion/environment sensors do not need a runtime permission. These do:

```text
ACTIVITY_RECOGNITION
  motion_detect
  significant_motion
  stationary_detect
  step_counter
  step_detector

BODY_SENSORS
  heart_beat
  heart_rate
```

If permission is missing, the sensor appears in `unavailable` with
`reason: "permission_required"` and the Android permission name.

## Sensor Status

After a sensor handshake, APPS Bridge sends `sensor_status`.

```json
{
  "type": "sensor_status",
  "data": {
    "ok": true,
    "active": true,
    "app": "com.example.sensorhud",
    "name": "Sensor HUD",
    "registered": [
      {
        "id": "motion",
        "sensor": "accelerometer",
        "sensorType": 1,
        "rateMs": 100,
        "sensorName": "BMI160 Accelerometer"
      }
    ],
    "unavailable": [
      {
        "id": "heart",
        "sensor": "heart_rate",
        "sensorType": 21,
        "rateMs": 250,
        "reason": "permission_required",
        "permission": "android.permission.BODY_SENSORS"
      }
    ],
    "timestamp": 1760000000000
  },
  "timestamp": 1760000000000
}
```

Unavailable reasons:

```text
not_available        The phone does not expose that sensor.
permission_required  APPS Bridge lacks the required Android permission.
listener_rejected    Android rejected the SensorManager listener.
```

If no sensors register, `ok` is false and `active` is false.

If a sensor declaration is invalid, the status can be:

```json
{
  "type": "sensor_status",
  "data": {
    "ok": false,
    "active": false,
    "error": "sensor request at index 0 has unknown sensor",
    "timestamp": 1760000000000
  },
  "timestamp": 1760000000000
}
```

## Sensor Events

Frame:

```json
{
  "type": "sensor_event",
  "app": "com.example.sensorhud",
  "name": "Sensor HUD",
  "source": "motion",
  "sensor": "accelerometer",
  "sensorType": 1,
  "data": {
    "timestamp": 1760000000000,
    "sensorTimestampNanos": 123456789,
    "accuracy": 3,
    "values": [0.01, 9.77, 0.25],
    "x": 0.01,
    "y": 9.77,
    "z": 0.25
  }
}
```

Sensor event fields:

| Field | Type | Notes |
| --- | --- | --- |
| `source` | string | The request id for this source. |
| `sensor` | string | APPS Bridge sensor key. |
| `sensorType` | number | Android sensor type integer. |
| `data.timestamp` | number | Wall-clock ms from APPS Bridge. |
| `data.sensorTimestampNanos` | number | Android event timestamp. |
| `data.accuracy` | number | Android event accuracy. |
| `data.values` | number array | Raw Android sensor values. |
| `data.x/y/z` | number | First three values, present when available. |

Interpret `values` using Android's documented semantics for that sensor type.

## WebSocket: sensor_snapshot

Request:

```json
{
  "type": "sensor_snapshot",
  "requestId": "snap-1"
}
```

Response:

```json
{
  "type": "sensor_response",
  "action": "sensor_snapshot",
  "ok": true,
  "requestId": "snap-1",
  "data": {
    "name": "Sensor HUD",
    "sources": {
      "motion": {
        "timestamp": 1760000000000,
        "sensorTimestampNanos": 123456789,
        "accuracy": 3,
        "values": [0.01, 9.77, 0.25],
        "x": 0.01,
        "y": 9.77,
        "z": 0.25
      }
    },
    "empty": false,
    "timestamp": 1760000000000
  },
  "timestamp": 1760000000000
}
```

Snapshots are per WebSocket client.

## WebSocket: sensor_stop

Request:

```json
{
  "type": "sensor_stop",
  "requestId": "stop-1"
}
```

Response:

```json
{
  "type": "sensor_response",
  "action": "sensor_stop",
  "ok": true,
  "requestId": "stop-1",
  "data": {
    "ok": true,
    "active": false,
    "app": "",
    "name": "",
    "reason": "sensor_stop",
    "timestamp": 1760000000000
  },
  "timestamp": 1760000000000
}
```

If sensors were active, a `sensor_status` inactive frame can also be sent.

## Caption And Phone Audio Frames

Caption mode currently implemented:

```text
phone_audio
  wireValue: phone_audio
  source: android_media
```

Start phone-audio capture:

```json
{
  "type": "cc_command",
  "command": "start",
  "mode": "phone_audio"
}
```

Stop phone-audio capture:

```json
{
  "type": "cc_command",
  "command": "stop",
  "mode": "phone_audio",
  "reason": "user_stopped"
}
```

Report caption UI state:

```json
{
  "type": "cc_state",
  "capturing": true,
  "mode": "phone_audio"
}
```

Phone audio requires:

```text
Android 10 or newer
RECORD_AUDIO permission
Android MediaProjection permission prompt
AudioPlaybackCapture support from the playing app
```

When capture starts, APPS Bridge runs a foreground service and records supported
Android playback audio as 16 kHz mono PCM16.

Status frame:

```json
{
  "type": "cc_status",
  "mode": "phone_audio",
  "source": "android_media",
  "timestamp": 1760000000000,
  "enabled": true,
  "capturing": true,
  "engine": "webview_whisper"
}
```

Audio frame:

```json
{
  "type": "cc_audio",
  "mode": "phone_audio",
  "source": "android_media",
  "timestamp": 1760000000000,
  "format": "pcm_s16le",
  "sampleRate": 16000,
  "channels": 1,
  "audioBase64": "base64-pcm-bytes"
}
```

Caption text frames:

```json
{
  "type": "caption_partial",
  "mode": "phone_audio",
  "source": "android_media",
  "timestamp": 1760000000000,
  "text": "partial caption text"
}
```

```json
{
  "type": "caption_final",
  "mode": "phone_audio",
  "source": "android_media",
  "timestamp": 1760000000000,
  "text": "final caption text"
}
```

Text is capped to 500 characters per frame.

Error frame:

```json
{
  "type": "cc_error",
  "mode": "phone_audio",
  "source": "android_media",
  "timestamp": 1760000000000,
  "message": "Audio capture permission required"
}
```

## HTTP Endpoints

Base URL:

```text
http://127.0.0.1:7070
```

The app must request `http` in `components` before these endpoints are
available.

```text
GET     /health       -> text/plain "ok"
GET     /gps          -> current GPS JSON
GET     /media        -> current media JSON
GET     /nav          -> current navigation JSON
GET     /debug/nav    -> raw navigation notification fields and parsed values
GET     /events       -> Server-Sent Events for gps, media, and nav
POST    /media/play   -> send media play command
POST    /media/pause  -> send media pause command
POST    /media/next   -> send media next command
POST    /media/prev   -> send media previous command
OPTIONS any           -> CORS preflight
```

CORS headers:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

SSE endpoint:

```text
GET /events
Content-Type: text/event-stream
Events: gps, media, nav
Keepalive comment about every 25 seconds
```

Example SSE event:

```text
event: gps
data: {"speed":12.4,"heading":90.0,"lat":35.0,"lng":-80.0,"accuracy":6.0}
```

`/debug/nav` response:

```json
{
  "pkg": "com.google.android.apps.maps",
  "title": "500 ft",
  "text": "Turn right onto Main St",
  "big": "",
  "sub": "12:45",
  "info": "",
  "ticker": "",
  "parsed_instruction": "Turn right onto Main St",
  "parsed_distance": "500 ft",
  "parsed_active": true
}
```

Media command behavior:

1. The bridge first tries active media session transport controls.
2. It also sends Android media key events through AudioManager.
3. Commands are best-effort and depend on the active media app.

## Browser/WebView Examples

WebSocket full example:

```js
const bridge = new WebSocket("ws://127.0.0.1:7071");

const components = ["gps", "media", "nav", "http", "sensors"];

bridge.addEventListener("open", () => {
  bridge.send(JSON.stringify({
    type: "client_hello",
    app: "com.example.ridehud",
    name: "Ride HUD",
    components,
    managedLifecycle: true,
    sensors: [
      { id: "motion", sensor: "accelerometer", rateMs: 100 },
      { id: "turn", sensor: "rotation_vector", rateMs: 100 }
    ]
  }));
});

bridge.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "gps") {
    const mph = msg.data.speed * 2.236936;
    console.log("GPS", msg.data.lat, msg.data.lng, mph);
  }

  if (msg.type === "media") {
    console.log("Media", msg.data.title, msg.data.artist, msg.data.status);
  }

  if (msg.type === "nav") {
    console.log("Nav", msg.data.instruction, msg.data.distance);
  }

  if (msg.type === "sensor_event") {
    console.log("Sensor", msg.source, msg.sensor, msg.data.values);
  }

  if (msg.type === "sensor_status") {
    console.log("Sensor status", msg.data);
  }
});

const heartbeat = setInterval(() => {
  if (bridge.readyState !== WebSocket.OPEN) return;
  bridge.send(JSON.stringify({
    type: "client_heartbeat",
    active: true,
    components
  }));
}, 15000);

window.addEventListener("beforeunload", () => {
  clearInterval(heartbeat);
  if (bridge.readyState === WebSocket.OPEN) {
    bridge.send(JSON.stringify({ type: "client_goodbye", active: false }));
  }
});
```

Discover sensors:

```js
bridge.send(JSON.stringify({
  type: "sensor_list",
  requestId: "sensor-list-1"
}));
```

Snapshot latest sensor values:

```js
bridge.send(JSON.stringify({
  type: "sensor_snapshot",
  requestId: "snap-1"
}));
```

Stop sensors:

```js
bridge.send(JSON.stringify({
  type: "sensor_stop",
  requestId: "stop-1"
}));
```

HTTP polling:

```js
const gps = await fetch("http://127.0.0.1:7070/gps").then(r => r.json());
const media = await fetch("http://127.0.0.1:7070/media").then(r => r.json());
const nav = await fetch("http://127.0.0.1:7070/nav").then(r => r.json());
```

EventSource:

```js
const events = new EventSource("http://127.0.0.1:7070/events");

events.addEventListener("gps", (event) => {
  const gps = JSON.parse(event.data);
  console.log(gps.lat, gps.lng, gps.speed);
});

events.addEventListener("media", (event) => {
  console.log(JSON.parse(event.data));
});

events.addEventListener("nav", (event) => {
  console.log(JSON.parse(event.data));
});
```

Media control:

```js
await fetch("http://127.0.0.1:7070/media/play", { method: "POST" });
await fetch("http://127.0.0.1:7070/media/pause", { method: "POST" });
await fetch("http://127.0.0.1:7070/media/next", { method: "POST" });
await fetch("http://127.0.0.1:7070/media/prev", { method: "POST" });
```

Phone audio capture:

```js
bridge.send(JSON.stringify({
  type: "cc_command",
  command: "start",
  mode: "phone_audio"
}));
```

Stop phone audio:

```js
bridge.send(JSON.stringify({
  type: "cc_command",
  command: "stop",
  mode: "phone_audio",
  reason: "user_stopped"
}));
```

## Error Handling Rules

WebSocket message parsing is best-effort. Invalid JSON or unknown messages are
ignored/logged by APPS Bridge, not returned as general error frames.

Sensor request errors are returned as `sensor_status` with `ok: false`.

Missing sensor permissions are returned in the `unavailable` array. Valid
sensors in the same request can still run.

Phone-audio errors are returned as `cc_error`.

HTTP unknown paths return 404 with `Not found`.

## Battery And Performance Guidance

1. Request only the components your app is actively using.
2. Send `client_goodbye` when your app backgrounds or no longer needs data.
3. Prefer explicit sensor lists over `all`.
4. Avoid very fast `rateMs` unless the UI actually needs it.
5. Use `sensor_snapshot` for occasional reads instead of streaming high-rate
   sensors.
6. Convert GPS speed from meters per second in your app.
7. Smooth display values in the glasses app rather than changing bridge data.

## Troubleshooting

Bridge does not connect:

```text
Make sure APPS Bridge is turned on.
Use ws://127.0.0.1:7071 from the same Android device.
Launch the bridge intent if your WebView is responsible for waking the bridge.
```

HTTP endpoints return nothing:

```text
Request the http component first.
Confirm the bridge is active and your WebSocket client is connected.
```

GPS has no fix:

```text
Grant Location in APPS Bridge.
Enable phone location/GPS.
Request gps in components.
Open sky or wait for first fix.
```

Media/nav empty:

```text
Grant notification listener access.
Request media and/or nav.
For nav, use a supported navigation app and active route.
Use /debug/nav to inspect raw notification fields.
```

Sensor missing:

```text
Call sensor_list.
Check permission and permissionGranted.
Check unavailable reason in sensor_status.
Use sensorType for vendor/private sensor types.
```

Phone audio fails:

```text
Android 10+ is required.
Grant RECORD_AUDIO.
Accept the MediaProjection capture prompt.
The playing app must allow Android playback capture.
```

## Coding Agent Implementation Instructions

When feeding this document to a coding agent, give it these rules:

1. Use `ws://127.0.0.1:7071` as the primary bridge.
2. Send `client_hello` immediately after WebSocket open.
3. Always include a user-visible `name`.
4. Always include explicit `components`.
5. Use `managedLifecycle: true` and heartbeat every 15 seconds.
6. Send `client_goodbye` before closing when possible.
7. Parse all inbound frames by `type`.
8. Treat `gps.data.speed` as meters per second.
9. Treat `sensor_list` as the source of truth for available sensors.
10. Expect null/empty fields when Android has not produced data yet.
11. Request `http` before using HTTP/SSE endpoints.
12. Do not assume arbitrary phone control. Only documented media and caption
    control APIs exist.

Minimal implementation checklist:

```text
Open WebSocket
Send client_hello with app/name/components
Start heartbeat timer
Handle gps/media/nav frames
Handle sensor_status/sensor_response/sensor_event if using sensors
Optionally use HTTP/SSE if http component is requested
Send client_goodbye on app shutdown/background
Close WebSocket
```

## Quick Copy-Paste Handshake

```json
{
  "type": "client_hello",
  "app": "com.example.myhud",
  "name": "My HUD",
  "components": ["gps", "media", "nav", "http", "sensors"],
  "managedLifecycle": true,
  "sensors": [
    { "id": "motion", "sensor": "accelerometer", "rateMs": 100 },
    { "id": "gyro", "sensor": "gyroscope", "rateMs": 100 },
    { "id": "rotation", "sensor": "rotation_vector", "rateMs": 100 }
  ]
}
```

## Version Notes

This guide documents the APPS Bridge universal bridge shape implemented in the
Android companion source at the time this Markdown was saved from the app. The
canonical runtime behavior is the Android code in:

```text
BridgeService.kt
WsServer.kt
BridgeServer.kt
SensorRequestManager.kt
GpsManager.kt
MediaListener.kt
LiveCaptionModels.kt
PhoneAudioCapture.kt
PhoneAudioCaptureService.kt
```

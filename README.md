# companion-module-marshall-cameras

This module supports Marshall IP cameras including the CV605 which uses VISCA over TCP protocol.

## Supported Cameras

- CV355, CV420, CV420e, CV620, CV630, CV730 (HTTP-based control)
- **CV605** (VISCA over TCP on port 1259)

## CV605 Configuration

For the CV605 camera:
1. Select "CV605 (VISCA over TCP)" as the camera model
2. Enter the camera's IP address
3. Set the TCP port (default: 1259)
4. No username/password required (VISCA doesn't use authentication)

## Features

- Pan/Tilt control with speed adjustment
- Zoom control (in/out/stop)
- Focus control (far/near/stop)
- Preset recall and storage
- Real-time status monitoring

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

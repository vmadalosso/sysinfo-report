<h1 align="center">SysInfo Report</h1>

<p align="center">
  Standalone system diagnostic tool that collects hardware and OS info and displays it in a local web UI.
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/static/v1?label=license&message=ISC&color=BD93F9&labelColor=282A36">
  <img alt="Node" src="https://img.shields.io/static/v1?label=node&message=%3E%3D18&color=50FA7B&labelColor=282A36">
  <img alt="Language" src="https://img.shields.io/static/v1?label=lang&message=JavaScript&color=F1FA8C&labelColor=282A36">
  <img alt="Platform" src="https://img.shields.io/static/v1?label=platform&message=Windows+%7C+Linux+%7C+macOS&color=FF79C6&labelColor=282A36">
</p>

<p align="center">
  <a href="#about">About</a> ·
  <a href="#features">Features</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#running-as-standalone-executable">Standalone Executable</a> ·
  <a href="#building-executables">Building</a> ·
  <a href="#configuration">Configuration</a>
</p>

---

## About

**SysInfo Report** is a system diagnostic tool for IT technicians. It collects comprehensive hardware and OS information and displays everything in a local web interface with the Dracula theme, real-time updates, and CSV export. It ships as a standalone executable — no Node.js installation required on the end-user's machine.

---

## Features

- **Local web UI** with Dracula theme, category cards, and progress bars
- **Auto-refresh** every 30 seconds without reloading the page
- **Opens the browser automatically** on startup (macOS, Windows, and Linux)
- **CSV export** compatible with Excel (UTF-8 BOM)
- **Standalone executable** — no Node.js needed on the end-user's machine
- **Cross-compilation** — build a Windows `.exe` from macOS

### Collected Data

| Category    | Details                                                               |
| ----------- | --------------------------------------------------------------------- |
| System      | Manufacturer, model, serial number, motherboard, BIOS version, uptime |
| OS          | Distro, version, build, architecture, hostname, timezone              |
| CPU         | Model, manufacturer, base/turbo speed, cores, threads, temperature    |
| RAM         | Total, current usage, available; slots with DDR type and frequency    |
| Storage     | Physical disks (SSD/HDD/NVMe) with per-partition usage                |
| GPU         | Model, manufacturer, VRAM                                             |
| Monitors    | Real model name (via EDID), connection, resolution, refresh rate      |
| Network     | Active interfaces with IP, Wi-Fi network name (SSID), MAC, type       |
| Battery     | Percentage, charging status, remaining time                           |
| Peripherals | Installed printers, connected USB devices                             |

> On macOS, the exact monitor name is read via `system_profiler SPDisplaysDataType` (EDID), returning the real model — e.g. "BenQ GL2780" — instead of a generic identifier.

---

## Tech Stack

| Tool                                                                  | Purpose                                   |
| --------------------------------------------------------------------- | ----------------------------------------- |
| [Node.js 18+](https://nodejs.org)                                     | Runtime                                   |
| [systeminformation](https://systeminformation.io)                     | Hardware/OS data collection               |
| `node:http` (native)                                                  | HTTP server — no external frameworks      |
| HTML / CSS / JS (vanilla) + [Dracula Theme](https://draculatheme.com) | Frontend                                  |
| [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg)                      | Build & distribution as standalone binary |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18

### 1. Clone the repository

```bash
git clone https://github.com/vmadalosso/sysinfo-report.git
cd sysinfo-report
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run

```bash
npm start
```

The browser opens automatically at `http://localhost:9999`.

To use a different port:

```bash
PORT=8080 node collectSystemInfo.js
```

Press `Ctrl+C` to stop.

---

## Running as Standalone Executable

Download the binary for your platform and run it directly — no Node.js installation required.

**Windows**

```
sysinfo-report-win.exe
```

> Windows Defender SmartScreen may show a warning on first run due to the lack of a digital signature. Click **"More info" → "Run anyway"**.

**Linux**

```bash
chmod +x sysinfo-report-linux
./sysinfo-report-linux
```

**macOS**

```bash
chmod +x sysinfo-report-macos-arm   # or sysinfo-report-macos-intel
./sysinfo-report-macos-arm
```

> If macOS blocks the binary: **System Settings → Privacy & Security → "Open Anyway"**.

---

## Building Executables

```bash
npm install

mkdir -p dist

npm run build:win        # → dist/sysinfo-report-win.exe
npm run build:linux      # → dist/sysinfo-report-linux
npm run build:mac-arm    # → dist/sysinfo-report-macos-arm   (M1/M2/M3/M4)
npm run build:mac-intel  # → dist/sysinfo-report-macos-intel (Intel)
npm run build:all        # all at once
```

`pkg` supports cross-compilation — you can build the Windows `.exe` from macOS without a Windows machine.

The first build takes longer as `pkg` downloads the Node.js binary for each target platform. Subsequent builds are fast.

**Binary sizes**

| Platform    | File                         | Approx. size |
| ----------- | ---------------------------- | ------------ |
| Windows x64 | `sysinfo-report-win.exe`     | ~55–70 MB    |
| Linux x64   | `sysinfo-report-linux`       | ~45–60 MB    |
| macOS ARM   | `sysinfo-report-macos-arm`   | ~45–60 MB    |
| macOS Intel | `sysinfo-report-macos-intel` | ~45–60 MB    |

Size includes the entire Node.js runtime embedded in the binary.

---

## Configuration

| Variable | Default | Description      |
| -------- | ------- | ---------------- |
| `PORT`   | `9999`  | HTTP server port |

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made with ♥ by <a href="https://github.com/vmadalosso">Vitor Madalosso</a>
</p>

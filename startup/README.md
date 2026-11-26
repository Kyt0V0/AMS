# AMS Startup Scripts (Cross-Platform)

These scripts help install dependencies, start the backend, and build/run the Tauri desktop app.

## Files
- `startup_macos.sh` for macOS
- `startup_linux.sh` for Linux
- `startup_windows.bat` for Windows
- `startup_macos.command` macOS double-click launcher
- `startup_linux.desktop` Linux double-click launcher (file-manager/desktop environments)

## Notes
- The backend and frontend are still separate processes in this coursework version.
- Tauri output is platform-specific:
  - macOS: `.app`
  - Windows: `.exe`/installer
  - Linux: AppImage/deb/rpm depending environment
- Use these scripts from the project root:
  - `AMS/startup/startup_macos.sh`
  - `AMS/startup/startup_linux.sh`
  - `AMS/startup/startup_windows.bat`

## Double-Click Use
- macOS: double-click `startup_macos.command`.
- Windows: double-click `startup_windows.bat`.
- Linux: mark `startup_linux.desktop` as executable/trusted, then double-click it.
  - If your desktop asks whether to run or open, choose **Run**.

## Security/Implementation Notes (AQA NEA)
- Scripts run migrations before backend startup so schema state is consistent.
- App crypto behavior is unchanged: plaintext credentials/master password are not sent to backend.
- These scripts only automate setup/start; they do not alter encryption logic.

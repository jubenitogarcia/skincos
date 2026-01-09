# Unit Monitor - Camera Recording via Google Home

A comprehensive application for monitoring, recording, and managing video streams from smart cameras through the Google Home web interface.

## Overview

Unit Monitor provides a way to record video streams from Google Home connected cameras when direct RTSP access is not available. The application uses screen capture technology to record what you see in Google Home, with intelligent automation and comprehensive testing tools.

## Key Features

### Screen Recording
- High-quality capture with multiple resolution options (480p, 720p, 1080p)
- Format flexibility supporting WebM and MP4 formats
- Auto-recording triggers when camera feeds are detected
- Manual controls with real-time recording status
- Comprehensive logging with detailed recording analytics

### Google Home Integration
- Automated WebView loading home.google.com
- Smart camera detection using DOM monitoring
- Video player recognition with visual status indicators
- Camera favorites for quick access automation
- Navigation controls with back/forward/refresh options

### Advanced Testing Suite
- Screen capture API validation with permission checking
- MediaRecorder compatibility testing across formats
- Real-time recording tests with quality analysis
- Google Home connection simulation for development
- Comprehensive diagnostic reports and troubleshooting

### Settings and Management
- Persistent configuration using local storage
- Recording path selection with native file dialogs
- Quality and format preferences with smart defaults
- Auto-recording configuration with duration limits
- System logs with filterable event levels

## Quick Start

### 1. Screen Recording Test
1. Navigate to the Test tab in the left sidebar
2. Click Screen Recording subtab
3. Run Run All Tests to verify browser capabilities
4. Grant screen capture permissions when prompted
5. Verify all tests pass (green checkmarks)
6. Try Manual Recording Test to create a sample recording

### 2. Google Home Setup
1. Click Google Home subtab in Test section
2. Open the Google Home interface (will load automatically in main area)
3. Login to your Google account manually
4. Navigate to your camera feeds
5. Verify Video Active status appears when camera is visible

### 3. Real Camera Recording
1. Go to Settings tab and select Recording Folder
2. Choose your preferred quality and format settings
3. Enable Auto Record if desired
4. Navigate to Google Home and open a camera feed
5. Start recording manually or wait for auto-trigger
6. Recorded files will be saved to your chosen folder

## Technical Requirements

### Browser Compatibility
- Chrome/Chromium (recommended) - full screen capture support
- Edge - good compatibility with most features
- Firefox - limited screen capture support
- Safari - minimal support, not recommended

### System Permissions
- Screen recording - required for video capture
- File system access - for saving recordings
- Camera detection - for monitoring Google Home interface

### Performance Requirements
- RAM: 4GB minimum, 8GB recommended for high-quality recording
- CPU: modern dual-core processor
- Storage: adequate free space for video files (1GB+ recommended)
- Network: stable internet connection for Google Home access

## Testing Your Setup

The application includes comprehensive testing tools to verify functionality:

### Automated Tests
- Screen Capture API Support - verifies browser capabilities
- MediaRecorder Support - tests video encoding formats
- Permission Handling - validates screen recording access
- Recording Functionality - creates test recordings
- Camera Detection - simulates video player recognition

### Manual Verification
- Google Home Connection - verify login and navigation
- Camera Feed Detection - test Video Active status updates
- Recording Quality - compare different quality settings
- File Management - verify recordings save correctly

## Recording Settings

### Quality Options
- High (1080p) - best quality, larger file sizes (~50-100MB/min)
- Medium (720p) - balanced quality and size (~25-50MB/min)
- Low (480p) - compact files, lower quality (~10-25MB/min)

### Format Comparison
- WebM - smaller files, better compression, may have compatibility issues
- MP4 - larger files, universal compatibility, industry standard

### Auto-Recording Features
- Video Detection - automatically starts when camera feed appears
- Duration Limits - prevents excessively long recordings
- Smart Stopping - stops when video disappears or user navigates away

## Troubleshooting

### Common Issues

#### Screen Capture Permission Denied
- Solution: check browser settings and enable screen recording
- Chrome: Settings -> Privacy -> Site Settings -> Additional Permissions -> Screen Capture
- Edge: similar path in Edge settings
- Alternative: try using Chrome or Edge if other browsers fail

#### Recording Shows Black Screen
- Cause: some applications block screen capture for security
- Solution: try capturing entire screen instead of just browser window
- Alternative: use different browser or incognito mode

#### Auto-Recording Not Starting
- Check: verify Video Active status appears when camera is visible
- Solution: Google Home interface changes may affect detection
- Workaround: use manual recording as fallback

#### Large File Sizes
- Solution: use lower quality settings or WebM format
- Management: set reasonable duration limits for auto-recording
- Cleanup: regularly review and delete old recordings

### Performance Optimization

#### For Better Quality
- Use Chrome or Edge browser
- Close unnecessary tabs and applications
- Record in full-screen mode
- Ensure stable internet connection
- Use high-quality setting for important recordings

#### For Better Performance
- Use medium or low quality for long recordings
- Set reasonable maximum duration limits
- Monitor available disk space regularly
- Clear old recordings to free up space
- Use WebM format for smaller file sizes

## Privacy and Legal Considerations

### Important Guidelines
- Only record cameras you own or have explicit permission to monitor
- This tool captures what you can already see in Google Home
- All recordings are stored locally on your computer
- Ensure compliance with local privacy laws and regulations
- Respect others' privacy and obtain consent when required

### Technical Privacy
- No cloud uploads - all data stays on your device
- No audio recording - only video is captured (by design)
- Local storage only - no external data transmission
- User-controlled - you manage all recordings and settings

## Development and Production

### Development Mode
- Simulated Google Home interface with testing placeholders
- Mock camera detection and automation features
- Full testing suite with simulated results
- Browser-based screen capture for development

### Production Deployment
Consider packaging as an Electron application for:
- Better performance and native system integration
- Enhanced file system access and management
- Native screen capture APIs (desktopCapturer)
- System-level permissions handling
- Improved stability and user experience

## Expected Results

### Successful Setup Shows
- All automated tests pass (green checkmarks)
- Screen capture permissions granted without issues
- Video recording capabilities detected and working
- Manual recording produces playable video files
- Google Home camera feeds detected as Video Active
- Auto-recording triggers appropriately when video appears
- Recorded files save to specified location with correct naming
- Quality settings affect file size and clarity as expected

### Known Limitations
- No audio recording (by design for privacy)
- Recording quality limited by display resolution and Google Home interface
- Some browsers may have format or API limitations
- Google Home interface changes may occasionally affect video detection
- Performance depends on system resources and network stability

## Support and Help

### Built-in Help
- Help Dialog - setup and usage guide accessible via header button
- Testing Guide - step-by-step testing instructions in Test -> Testing Guide
- System Logs - real-time diagnostic information in left sidebar
- Status Indicators - visual feedback for all system components

### Advanced Features
- Camera Favorites - save automation scripts for frequently accessed cameras
- Batch Testing - run comprehensive tests on multiple cameras
- Performance Analytics - monitor recording quality and system performance
- Export Capabilities - download test recordings for quality verification

Note: This application is designed to work with cameras you own and have legitimate access to monitor. Always ensure compliance with local laws and respect privacy rights when recording video content.

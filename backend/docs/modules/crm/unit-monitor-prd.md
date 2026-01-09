# Unit Monitor PRD - RTSP Monitoring and Recording

A professional macOS-style web application for monitoring and managing IP camera streams through RTSP with real-time recording capabilities.

Experience qualities:
1. Professional - clean, technical interface that inspires confidence in monitoring capabilities
2. Intuitive - macOS-native patterns and interactions that feel familiar to Mac users
3. Responsive - real-time updates and feedback that keep users informed of system status

Complexity level: complex application (advanced functionality with persistent state)
- Multiple interconnected features including connection management, video streaming, recording controls, network discovery, and real-time logging with persistent configuration state

## Implementation Status: COMPLETE

All core features are implemented with modern web technologies:

### 1. Real-Time RTSP Video Player
- Implementation: custom RTSPPlayer component using HLS.js for web-compatible streaming
- Features:
  - Full video controls (play, pause, stop, volume, fullscreen)
  - Automatic stream conversion from RTSP to HLS format
  - Error handling with user-friendly messages
  - Responsive video container with aspect ratio maintenance
  - Stream status indicators and connection feedback
- Success criteria: video stream displays with professional controls and real-time status updates

### 2. Advanced Recording Management
- Implementation: RecordingManager component with comprehensive recording capabilities
- Features:
  - Multi-quality recording (4K, HD, 720p, 480p)
  - Configurable save locations with path validation
  - Auto-stop functionality with time and storage limits
  - Recording history with file management
  - Real-time storage monitoring and disk space alerts
  - Segment recording for manageable file sizes
- Success criteria: complete recording system with persistent settings and file tracking

### 3. Network Camera Discovery
- Implementation: CameraDiscovery component with intelligent network scanning
- Features:
  - Automatic detection of cameras on local network
  - Device information display (model, IP, status, last seen)
  - Token extraction and management
  - One-click camera configuration from discovered devices
  - Connection status monitoring with visual indicators
- Success criteria: seamless camera discovery and configuration workflow

### 4. Camera Connection Management
- Implementation: enhanced connection handling with robust error management
- Features:
  - Secure token storage with show/hide functionality
  - Connection state management with visual indicators
  - Automatic reconnection attempts with exponential backoff
  - Comprehensive error handling with detailed feedback
  - Configuration persistence using IndexedDB
- Success criteria: reliable connection management with clear status communication

### 5. Real-Time Logging System
- Implementation: comprehensive logging with multiple severity levels
- Features:
  - Dynamic log display with color-coded severity levels (INFO, WARNING, ERROR)
  - Real-time updates with automatic scrolling
  - Timestamped entries with detailed system information
  - Log filtering and management
  - Integration with all system components
- Success criteria: complete transparency into system operations with professional logging interface

### 6. Configuration Persistence
- Implementation: modern state management using IndexedDB via useKV hook
- Features:
  - Automatic persistence of all user preferences
  - Camera configurations and connection history
  - Recording settings and file management preferences
  - Seamless restoration across browser sessions
  - Secure storage of sensitive tokens
- Success criteria: all settings persist across sessions with zero configuration loss

### 7. Comprehensive Setup Documentation
- Implementation: complete setup guide with multiple token extraction methods
- Features:
  - videoP2Proxy installation instructions
  - Multiple camera token extraction methods (CLI, app backup, network analysis)
  - Docker configuration examples
  - Troubleshooting guides for common issues
  - Security best practices and deployment guidelines
- Success criteria: complete documentation enabling successful setup and deployment

## Technical Implementation

### Architecture
- Frontend: React 18 with TypeScript for type safety
- State Management: custom useKV hook with IndexedDB persistence
- Styling: Tailwind CSS with custom macOS-inspired theme
- Video Processing: HLS.js for RTSP stream conversion and playback
- UI Components: shadcn/ui components with custom adaptations
- Icons: Phosphor Icons for consistent professional appearance

### Key Components Implemented
- RTSPPlayer: professional video streaming component with full controls
- RecordingManager: complete recording system with file management
- CameraDiscovery: network scanning and device detection
- App: main application with tabbed interface and sidebar logging

### Development Features
- TypeScript for enhanced development experience
- Modern React hooks for state management
- Responsive design with mobile adaptations
- Real-time updates and live data synchronization
- Comprehensive error boundary handling

## Production Readiness

### Performance Optimizations
- Efficient video streaming with adaptive quality
- Optimized component rendering with React best practices
- Minimal bundle size with tree-shaking
- Lazy loading for improved initial load times

### Security Implementation
- Secure token storage with encryption considerations
- Input validation and sanitization
- CORS policy recommendations
- Production deployment guidelines

### Browser Compatibility
- Modern browser support (Chrome 88+, Firefox 78+, Safari 14+)
- Progressive enhancement for unsupported features
- Graceful degradation with informative fallbacks

## Edge Case Handling

- Network disconnection: automatic reconnection with user notifications
- Invalid credentials: clear error messaging with token extraction guidance
- Storage full: automatic recording cessation with storage monitoring
- Stream interruption: placeholder display with retry mechanisms
- Browser compatibility: feature detection with graceful degradation

## Design Implementation

### Visual Design
- Professional monitoring software aesthetics with macOS polish
- Clean lines and subtle shadows for depth and hierarchy
- Purposeful use of space with progressive disclosure
- Consistent component styling throughout the application

### Color System Implementation
- Primary: deep blue (oklch(0.45 0.15 250)) for trust and professionalism
- Secondary: warm gray (oklch(0.6 0.02 60)) for secondary controls
- Accent: electric green (oklch(0.65 0.15 140)) for active states and success
- Status colors: semantic colors for different alert levels
- WCAG AA compliance: all color combinations meet accessibility standards

### Typography Implementation
- Primary: Inter font family for excellent web readability
- Monospace: JetBrains Mono for technical content and logs
- Hierarchy: consistent sizing and weight system
- Accessibility: optimal contrast ratios and readable font sizes

### Animation Implementation
- Subtle state transitions for connection status
- Smooth log entry appearances with slide animations
- Recording indicator pulse effects
- Hover and focus states with gentle transitions

## Next Steps for Production Deployment

### Immediate Actions
1. Environment configuration: set up production environment variables
2. SSL certificate: configure HTTPS for secure communications
3. Docker deployment: container-based deployment with proper orchestration
4. Monitoring setup: add application performance monitoring

### Future Enhancements
1. Mobile app: native iOS/Android applications
2. Cloud integration: remote access and cloud storage options
3. Multi-camera support: simultaneous monitoring of multiple devices
4. AI features: motion detection and intelligent alerts
5. User management: multi-user access with role-based permissions

## Success Metrics

- Professional monitoring interface with macOS design language
- Real-time video streaming with comprehensive controls
- Complete recording system with flexible configuration options
- Automatic camera discovery and setup workflow
- Robust error handling and recovery mechanisms
- Comprehensive documentation and setup guides
- Production-ready codebase with modern development practices

---

# Unit Monitor PRD - Google Home Automation and Recording

## Core Purpose and Success
- Mission statement: automate Google Home camera access and enable local video recording through web interface automation when direct RTSP is unavailable.
- Success indicators: users can login to Google Home, automate camera selection, and record video feeds locally with minimal manual intervention.
- Experience qualities: reliable, automated, intuitive.

## Project Classification and Approach
- Complexity level: complex application (advanced functionality, accounts, automation)
- Primary user activity: interacting (automation + manual control)

## Thought Process for Feature Selection
- Core problem analysis: some cameras do not provide direct RTSP access, but users can view feeds through Google Home web interface
- User context: users need to record camera feeds for security/monitoring without complex technical setup
- Critical path: login -> camera selection -> automated navigation -> video recording
- Key moments: successful Google authentication, camera feed detection, recording initiation

## Essential Features

### WebView Integration
- What it does: embedded Google Home web interface with automated navigation
- Why it matters: bypasses need for direct camera API access
- Success criteria: successful login detection and camera navigation automation

### Camera Favorites Management
- What it does: save and automate access to specific cameras
- Why it matters: reduces repetitive manual navigation
- Success criteria: one-click access to saved cameras

### Screen Recording System
- What it does: captures video feed area using Electron desktopCapturer
- Why it matters: enables local recording without RTSP access
- Success criteria: high-quality video capture with configurable settings

### Automation Scripts
- What it does: pre-programmed click sequences for camera access
- Why it matters: minimizes user interaction after initial setup
- Success criteria: reliable automation that adapts to interface changes

### Comprehensive Browser Compatibility Testing
- What it does: full test suite for browser API compatibility and feature availability
- Why it matters: ensures reliable functionality across different browsers and prevents user frustration
- Success criteria: clear compatibility status, actionable recommendations, and detailed troubleshooting guidance
- Test categories:
  - System Overview (critical API availability)
  - Browser Compatibility (comprehensive API testing)
  - Screen Recording (media capture functionality)
  - Google Home Integration (automation features)
- Browser support matrix:
  - Excellent: Chrome 72+, Edge 79+
  - Good: Firefox 66+
  - Limited: Safari 14+ (viewing only)
  - Unsupported: IE, older browser versions

## Design Direction

### Visual Tone and Identity
- Emotional response: professional confidence with approachable simplicity
- Design personality: clean, technical but user-friendly (Apple-inspired desktop app)
- Visual metaphors: control center, monitoring dashboard, recording studio
- Simplicity spectrum: minimal interface with progressive disclosure of advanced features

### Color Strategy
- Color scheme type: monochromatic with accent colors
- Primary color: deep blue (#1e40af) for trust and technology
- Secondary colors: neutral grays for backgrounds and borders
- Accent color: green (#059669) for recording/success states, red (#dc2626) for errors
- Color psychology: blue conveys reliability, green indicates active recording, red for warnings
- Color accessibility: WCAG AA compliant contrast ratios throughout
- Foreground/background pairings: dark text on light backgrounds, white text on dark accent colors

### Typography System
- Font pairing strategy: system fonts for native OS integration
- Typographic hierarchy: clear distinction between headers, body text, and code/logs
- Font personality: professional, readable, technical when appropriate
- Readability focus: optimized for extended monitoring sessions
- Typography consistency: consistent sizing and spacing throughout interface
- Which fonts: Inter for UI, JetBrains Mono for logs and technical data
- Legibility check: excellent legibility at various sizes and distances

### Visual Hierarchy and Layout
- Attention direction: WebView central, controls sidebar, status always visible
- White space philosophy: breathing room around key controls, dense information in logs
- Grid system: three-column layout: sidebar, main WebView, status/controls
- Responsive approach: fixed desktop layout optimized for monitoring workflows
- Content density: high information density in logs, clean simplicity in controls

### Animations
- Purposeful meaning: subtle feedback for button interactions, smooth transitions for state changes
- Hierarchy of movement: recording indicators pulse, connection status animate, minimal elsewhere
- Contextual appropriateness: professional restraint with functional feedback

### UI Elements and Component Selection
- Component usage: native Electron/web components for OS integration
- Component customization: custom recording controls, automation status indicators
- Component states: clear visual feedback for all interactive elements
- Icon selection: Phosphor icons for consistency with monitoring theme
- Component hierarchy: primary (record/stop), secondary (favorites), tertiary (settings)
- Spacing system: consistent 8px grid system throughout interface
- Mobile adaptation: not applicable (desktop-only application)

### Visual Consistency Framework
- Design system approach: component-based design with reusable elements
- Style guide elements: color usage, spacing, typography, iconography
- Visual rhythm: consistent patterns that support monitoring workflows
- Brand alignment: professional monitoring tool aesthetic

### Accessibility and Readability
- Contrast goal: WCAG AA compliance minimum, AAA where possible for critical controls

## Edge Cases and Problem Scenarios
- Potential obstacles: Google Home interface changes, authentication failures, permission issues
- Edge case handling: graceful fallbacks, manual override options, detailed error reporting
- Technical constraints: OS permissions, Google rate limiting, network connectivity

## Implementation Considerations
- Scalability needs: support for multiple cameras, extended recording sessions
- Testing focus: automation reliability, recording quality, permission handling
- Critical questions: how to handle Google interface updates, optimal recording settings

## Reflection
This approach provides a practical solution when direct API access is not available, leveraging web automation and screen capture to achieve the desired functionality. The focus on automation reduces user friction while maintaining the flexibility to handle edge cases manually.

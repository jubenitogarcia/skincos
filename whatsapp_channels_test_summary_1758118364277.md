
# WhatsApp Channels Comprehensive Test Report
Generated: 2025-09-17T14:11:52.720Z
Environment: http://localhost:8099

## Summary
- **Total Channels Tested**: 9/9
- **Successful Channels**: 6
- **Failed Channels**: 3
- **Average Response Time**: 246ms

## Channel Results
### Channel 1 (Port 3001)
- **Status**: ✅ SUCCESS
- **Test Time**: 7155ms
- **Errors**: Failed to stop channel properly, Failed to restart channel

**Test Results:**
  - start: ✅ (2077ms)
  - qr: ✅ (7ms)
  - status: ✅ (26ms)
  - stop: ❌ (6ms)
  - restart: ❌ (18ms)
  - finalStatus: ✅ (5ms)
  - cleanup: ❌ (2ms)

### Channel 2 (Port 3002)
- **Status**: ❌ FAILED
- **Test Time**: 21ms
- **Errors**: Failed to start channel

**Test Results:**
  - start: ❌ (6ms)

### Channel 3 (Port 3003)
- **Status**: ❌ FAILED
- **Test Time**: 19ms
- **Errors**: Failed to start channel

**Test Results:**
  - start: ❌ (10ms)

### Channel 4 (Port 3004)
- **Status**: ✅ SUCCESS
- **Test Time**: 6093ms
- **Errors**: Failed to stop channel properly, Failed to restart channel

**Test Results:**
  - start: ✅ (1039ms)
  - qr: ✅ (12ms)
  - status: ✅ (15ms)
  - stop: ❌ (4ms)
  - restart: ❌ (2ms)
  - finalStatus: ❌ (6ms)
  - cleanup: ❌ (3ms)

### Channel 5 (Port 3005)
- **Status**: ✅ SUCCESS
- **Test Time**: 6142ms
- **Errors**: Failed to stop channel properly, Failed to restart channel

**Test Results:**
  - start: ✅ (1050ms)
  - qr: ✅ (12ms)
  - status: ✅ (9ms)
  - stop: ❌ (2ms)
  - restart: ❌ (3ms)
  - finalStatus: ❌ (15ms)
  - cleanup: ❌ (43ms)

### Channel 6 (Port 3006)
- **Status**: ✅ SUCCESS
- **Test Time**: 6091ms
- **Errors**: Failed to stop channel properly, Failed to restart channel

**Test Results:**
  - start: ✅ (1047ms)
  - qr: ✅ (13ms)
  - status: ✅ (7ms)
  - stop: ❌ (1ms)
  - restart: ❌ (2ms)
  - finalStatus: ❌ (6ms)
  - cleanup: ❌ (2ms)

### Channel 7 (Port 3007)
- **Status**: ✅ SUCCESS
- **Test Time**: 6204ms
- **Errors**: Failed to stop channel properly, Failed to restart channel

**Test Results:**
  - start: ✅ (1089ms)
  - qr: ✅ (16ms)
  - status: ✅ (15ms)
  - stop: ❌ (2ms)
  - restart: ❌ (35ms)
  - finalStatus: ❌ (13ms)
  - cleanup: ❌ (6ms)

### Channel 8 (Port 3008)
- **Status**: ❌ FAILED
- **Test Time**: 2011ms
- **Errors**: Failed to start channel

**Test Results:**
  - start: ❌ (1982ms)

### Channel 9 (Port 3009)
- **Status**: ✅ SUCCESS
- **Test Time**: 7522ms
- **Errors**: Failed to stop channel properly, Failed to restart channel

**Test Results:**
  - start: ✅ (2199ms)
  - qr: ✅ (187ms)
  - status: ✅ (7ms)
  - stop: ❌ (17ms)
  - restart: ❌ (3ms)
  - finalStatus: ❌ (60ms)
  - cleanup: ❌ (8ms)


## Failure Scenarios
- **portOccupied**: ⏭️ Skipped
- **invalidChannel**: ✅ Tested
- **qrTimeout**: ⏭️ Skipped
- **doubleStart**: ✅ Tested

## Recommendations
- Some channels failed - check error logs and retry failed operations

## Detailed Results
Full detailed results saved to: whatsapp_channels_test_report_1758118364251.json

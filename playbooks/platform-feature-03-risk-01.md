## platform-feature-03-risk-01

### Title

Capture on-screen content

### Description

Capture on-screen content by recording the app display during an authorised screen recording session to collect sensitive information visible within the app (MITRE ATT&CK: ***Collection*** - TA0035).

### Demonstration
#### 01. Prepare the environment

Set up the required environment with:
* A physical iPhone 15 running iOS 17.6
* A physical macOS workstation with Xcode
* A target app installed on the iPhone

#### 02. Install screen recording app

Install the screen recording app on the iPhone. Use Xcode to open the [feature4-replay_consent_recorder](https://github.com/zhiyi-school/iosplaybook_sideload/tree/main/feature4) project, then build and run the app on the iPhone. 

``` swift
// Opens Apple's screen-recording consent picker
BroadcastPickerView(isEnabled: true, activationID: phoneRecordingRequestID)

// Receives screen frames from iOS and saves into file
override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    if sampleBufferType == .video {
        videoInput?.append(sampleBuffer)
    }
}
```

#### 03. Start screen recording

Tap `Start App Screen Recording`. When the system prompt appears, tap `Start Broadcast` to authorise and begin the recording.

<img src="attachments/feature3_risk1_ss1.png" width="400" alt="Replay Recorder app login screen">

*Screenshot shows notification from the app of the last screenshot saved*

<img src="attachments/feature3_risk1_ss2.png" width="400" alt="Screen recording start broadcast prompt">

*Screenshot shows screen mirroring popup*

#### 04. Reveal information in target app

Switch to the target app and enter or display information while the recording continues. This tests whether an authorised recording session from another malicious app can capture information displayed in the target app.

#### 05. Check for sensitive information

Stop the recording and review the recorded images and videos. Check whether the captured content includes sensitive information displayed in the target app.

<img src="attachments/feature3_risk1_ss3.png" width="400" alt="Sensitive information visible in screenshot">

*Screenshot shows visible username and blanked out password fields when both fields are filled*

<img src="attachments/feature3_risk1_ss4.png" width="400" alt="Captured screenshots and recordings saved in app container">

*Screenshot shows list of screen recording and screenshots taken by the malicious app*

Feature-03-Risk-01 control measures:

- [platform-feature-03-risk-01-control-01](platform-feature-03-risk-01-control-01.md)

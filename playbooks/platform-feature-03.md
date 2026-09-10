## platform-feature-03

### Title

Capture on-screen content

### Description

Capture on-screen content allow the device screen to be captured or displayed on another device through screenshots, screen recording, or AirPlay screen mirroring. This may expose sensitive information shown on the screen, such as usernames, email addresses, or other personal identifiable information.

### Demonstration
#### 01. Prepare the environment

Set up the required environment with:
* A physical iPhone 15 running iOS 17.6

#### 02. Capture on-screen content

Open the target app on the iPhone and capture the app interface using one of the following methods:

| Action            | Method                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshot        | Press the `Volume Up` button and the `Side` button at the same time, then quickly release both buttons.                                                                                                                                                                                                                   |
| Screen Recording  | Swipe down from the top-right corner of the screen to open `Control Centre`, then tap the Screen Recording button (a solid dot inside a circle).                                                                                                                                                                          |
| AirPlay Mirroring | On a macOS workstation, open `System Settings` and search for `AirPlay Receiver`. Turn `AirPlay Receiver` on and set `Allow AirPlay` for `to Everyone`. On the iPhone, open `Control Centre`, tap `Screen Mirroring`, and select the macOS workstation. View and capture the mirrored display from the macOS workstation. |

<img src="attachments/feature3_ss1.png" width="400" alt="Alt text">

*Screenshot shows the correct setting configured for Airplay*

<img src="attachments/feature3_ss2.png" width="400" alt="Alt text">

*Screenshot highlights the screen mirroring icon*

<img src="attachments/feature3_ss3.png" width="400" alt="Alt text">

*Screenshot shows list of targets for screen mirroring*

Because the iOS platform provides Screenshot feature, your app is at risk of:
- [platform-feature-03-risk-01](platform-feature-03-risk-01.md)

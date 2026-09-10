## platform-feature-04-risk-01

### Title

Capture text input

### Description

Capture text input by using a third-party custom keyboard to record and retain sensitive information entered into the app (MITRE ATT&CK: ***Collection*** - TA0035).

### Demonstration
#### 01. Prepare the environment

Set up the required environment with:
* A physical iPhone 15 running iOS 17.6
* A physical macOS workstation with Xcode
* A target app installed on the iPhone

#### 02. Install custom keyboard app

Install the custom keyboard app on the iPhone. Use Xcode to open the [feature4-localkeyboard](https://github.com/zhiyi-school/iosplaybook_sideload/tree/main/localkeyboard) project, then build and run the app on the iPhone.

``` swift
// Record each keystroke entered by the user
KeystrokeStore.append(text)
```

#### 03. Add custom keyboard to iPhone

Go to `Settings > General > Keyboard > Keyboards > Add New Keyboard`, then tap \[Keyboard Name] under Third-Party Keyboards. This enables the keyboard for use in apps.

<img src="attachments/feature4_ss2.png" width="400" alt="Alt text">

*Screenshot shows step1 of adding a third-party keyboard*

<img src="attachments/feature4_ss3.png" width="400" alt="Alt text">

*Screenshot shows step2 of adding a third-party keyboard*

<img src="attachments/feature4_ss4.png" width="400" alt="Alt text">

*Screenshot shows step3 of adding a third-party keyboard*

<img src="attachments/feature4_ss5.png" width="400" alt="Alt text">

*Screenshot shows step4 of adding a third-party keyboard*

<img src="attachments/feature4_ss6.png" width="400" alt="Alt text">

*Screenshot shows step5 of adding a third-party keyboard*

#### 04. Give custom keyboard full access

In the Keyboards list, tap \[Keyboard Name], then enable Allow Full Access. This grants the permissions required for features such as custom themes and autocomplete.

<img src="attachments/feature4_ss7.png" width="400" alt="Alt text">

*Screenshot shows how to access custom keyboard permissions*

<img src="attachments/feature4_ss8.png" width="400" alt="Alt text">

*Screenshot shows enabling full access to custom keyboard*

#### 05. Switch to custom keyboard

Open the target app, tap any text field to open the keyboard, then press and hold the Globe 🌐 icon to select the custom keyboard. This activates the custom keyboard in the target app.

<img src="attachments/feature4_risk1_ss1.png" width="400" alt="Alt text">

*Screenshot shows where to change to a custom keyboard*

#### 06. Check for captured text

Enter text into the target app using the custom keyboard, then return to the custom keyboard app to view the captured inputs. This verifies whether the custom keyboard can capture and retain text entered in the target app.

<img src="attachments/feature4_risk1_ss2.png" width="400" alt="Alt text">

*Screenshot shows key strokes logged by the custom keyboard's app*

Feature-04-Risk-01 control measures:

- [platform-feature-04-risk-01-control-01](platform-feature-04-risk-01-control-01.md)

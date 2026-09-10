## platform-feature-01-risk-02

### Description

Repackage the IPA

### Goal

Attackers could make permanent modifications to IPAs to avoid being detected. (MITRE ATT&CK: ***Defence Evasion*** - TA0030).
### Demonstration

#### 01. Prepare the environment

Set up the required environment with:

- A physical iPhone 15 running iOS 17.6
- A macOS workstation with Xcode, Apple Configurator, Terminal, and the `insert_dylib` utility
- A target app installed on the iPhone
- A valid Apple Development signing identity and compatible provisioning profile

#### 02. Provide access to app

Sign in to the same Apple ID on both the physical iOS device and the macOS workstation. This ensures Apple Configurator can access the app licenses and deploy apps associated with the Apple ID.

#### 03. Trigger IPA download

Connect the iPhone to the macOS workstation and open Apple Configurator. Select the connected device, open the Apps tab, click Add, and search for the target app. Adding the app causes Apple Configurator to download the current production package from Apple's servers and temporarily store it in the local cache.

<img src="attachments/feature1_ss1_apple_config.png" width="500" alt="Alt text">

_Screenshot shows connected device in Apple Configurator._

<img src="attachments/feature1_ss2_apple_config.png" width="500" alt="Alt text">

_Screenshot shows the_ `_Apps_` _tab on the connected device._

<img src="attachments/feature1_ss3_apple_config.png" width="500" alt="Alt text">

_Screenshot shows the_ `_+ > Apps_` _selection in Apple Configurator._

<img src="attachments/feature1_ss4_apple_config.png" width="500" alt="Alt text">

_Screenshot shows the list of available apps._

#### 04. Save IPA

On the macOS workstation, open Terminal and navigate to the Apple Configurator temporary cache directory for the newly created IPA file. Copy the file to a designated analysis workspace for modification.

``` shell
~/Library/Group\ Containers/K36BKF7T3D.group.com.apple.configurator/Library/Caches/Assets/TemporaryItems/MobileApps/
```

<img src="attachments/feature1_ss5_apple_config.png" width="500" alt="Alt text">

_Screenshot shows the target app IPA in the Apple Configurator cache directory._

#### 05. Add Frida Gadget to the app bundle

Use Apple's unzip utility to extract the newly created IPA into a working directory; patched-ipa and access the app bundle.

``` shell
unzip <TARGET_APP>.ipa -d patched-ipa

```

#### 06. Download Frida Gadget   

Download the [Frida Gadget](https://github.com/frida/frida/releases/download/17.9.10/frida-gadget-17.9.10-ios-universal.dylib.gz) build for iOS from the official Frida release page. The downloaded file is distributed as a compressed `.dylib.gz` file, so decompress it and rename to `FridaGadget.dylib` with the following commands.

``` shell
gunzip frida-gadget-17.9.10-ios-universal.dylib.gz
mv frida-gadget-17.9.10-ios-universal.dylib FridaGadget.dylib
```

#### 07. Put Frida Gadget in the app

Create a `Frameworks` directory in the app bundle, then copy the Frida Gadget library and configuration file into it.

``` shell
mkdir -p patched-ipa/Payload/TargetApp.app/Frameworks

cp FridaGadget.dylib patched-ipa/Payload/TargetApp.app/Frameworks/
cp FridaGadget.config patched-ipa/Payload/TargetApp.app/Frameworks/
```

*Code block shows commands used to add Frida Gadget to the target IPA.*

Modify the app's binary using `insert_dylib` such that it loads `FridaGadget.dylib` when the app starts.

``` shell
insert_dylib --strip-codesig --inplace "@executable_path/Frameworks/FridaGadget.dylib" "patched-ipa/Payload/TargetApp.app/TargetApp"
```

*Code block shows command used to patch binary in IPA.*

#### 08. Repackage the app

Re-sign all executable code in the modified app bundle, including `FridaGadget.dylib`, using the macOS `codesign` utility with a valid Apple Development signing identity and compatible entitlements.

``` shell
mkdir -p dist
cd patched-ipa
zip -qry ../dist/TargetApp-frida.ipa Payload
cd ..

codesign --force --sign "<SIGNING_IDENTITY>" \
  patched-ipa/Payload/TargetApp.app/Frameworks/FridaGadget.dylib

codesign --force --sign "<SIGNING_IDENTITY>" \
  --entitlements entitlements.plist \
  patched-ipa/Payload/TargetApp.app
```

#### 09. Install the app 

Use Apple's `devicectl` utility to note the `UDID` of the connected iPhone and install the signed `.app` bundle onto it.

``` shell
xcrun devicectl device install app \
  --device <DEVICE_UDID> \
  patched-ipa/Payload/TargetApp.app
```

*Code block shows commands used to resign and reinstall repackaged IPA.*

#### 10. Connect to Frida

Launch the modified app on the connected iPhone, then connect to the embedded Frida Gadget from the Mac to verify that the app was successfully repackaged with Frida.

``` shell
frida -U -n Gadget -l <FRIDA_SCRIPT>
```

*Command shows how to run Frida with script to hook onto function within app.*

Feature-01-Risk-02 control measures:

- [platform-feature-01-risk-02-control-01](app://-/platform-feature-01-risk-02-control-01.md)
- [platform-feature-01-risk-02-control-02](app://-/platform-feature-01-risk-02-control-02.md)

References:

- [https://mas.owasp.org/MASTG/techniques/ios/MASTG-TECH-0058/](https://mas.owasp.org/MASTG/techniques/ios/MASTG-TECH-0058/)


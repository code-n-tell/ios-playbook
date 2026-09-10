## platform-feature-01-risk-01

### Title

Analyse the IPA

### Description

Analyse the IPA using static analysis tools to identify sensitive plaintext information, such as hardcoded credentials, API keys, URLs, and configuration values (MITRE ATT&CK: ***Discovery*** - TA0032).

### Demonstration

#### 01. Prepare the environment

Set up the required environment with:
* A physical iPhone 15 running iOS 17.6
* A physical macOS workstation with Apple Configurator and Terminal
* A target app installed on the iPhone
* A MobSF instance running and accessible through a web browser

#### 02. Provide access to app

Sign in to the same Apple ID on both the physical iOS device and the macOS workstation. This ensures Apple Configurator can access the app licenses and deploy apps associated with the Apple ID.

#### 03. Trigger IPA download

Connect the iPhone to the macOS workstation and open Apple Configurator. Select the connected device, open the Apps tab, click Add, and search for the target app. Adding the app causes Apple Configurator to download the current production package from Apple's servers and temporarily store it in the local cache.

<img src="attachments/feature1_ss1_apple_config.png" width="500" alt="Alt text">

*Screenshot shows connect device on Apple Configurator*

<img src="attachments/feature1_ss2_apple_config.png" width="500" alt="Alt text">

*Screenshot shows `Apps` tab on connected device on Apple Configurator*

<img src="attachments/feature1_ss3_apple_config.png" width="500" alt="Alt text">

*Screenshot shows the selection of `+ > Apps` selection on Apple Configurator*

<img src="attachments/feature1_ss4_apple_config.png" width="500" alt="Alt text">

*Screenshot shows list of Apps on Apple Configurator*

#### 04. Save IPA

On the macOS workstation, open Terminal and navigate to the Apple Configurator temporary cache directory for the newly created .ipa file. Copy the file to your designated analysis workspace for static inspection and examination of its package structure.

<img src="attachments/feature1_ss5_apple_config.png" width="500" alt="Alt text">

``` shell
~/Library/Group\ Containers/K36BKF7T3D.group.com.apple.configurator/Library/Caches/Assets/TemporaryItems/MobileApps/
```

*Screenshot shows Singpass app in the cache directory*

#### 05. Analyse the IPA

Upload the .ipa file to MobSF and review the static analysis report for the app's overall security score, configuration issues, and sensitive information, such as hardcoded keys, embedded URLs, and other exposed data.

<img src="attachments/feature1_risk1_ss1.png" width="400" alt="Alt text">

*Screenshot shows possible exposed credentials and api key found by MobSF*

Feature-01-Risk-01 control measures:

- [platform-feature-01-risk-01-control-01](platform-feature-01-risk-01-control-01.md)
- [platform-feature-01-risk-01-control-02](platform-feature-01-risk-01-control-02.md)

References:

- https://mas.owasp.org/MASTG/techniques/ios/MASTG-TECH-0058/

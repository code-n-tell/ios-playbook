## platform-feature-01-risk-01
### Description
Because the iOS platform provides IPA acquisition feature, your application is at risk of an attacker analysing the application's IPA file.
### Goal
As a result, this could lead to _**discovery** - attackers figuring out the IPA’s vulnerabilities._
### Demonstration
Set up a workstation with the following configuration:

| Configuration | Detail                |
| ------------- | --------------------- |
| Prerequisite  | Platform-feature-01   |
| Workstation   | Web browser installed |

Perform the following steps to demonstrate the risk of an attacker analysing the application's IPA file:
1. Set up a mobile application analyser like Mobile Security Framework (MobSF) to perform analysis on IPAs
2. Upload a target IPA to initiate the analysis
<img src="../attachments/IPA_Acquisition_Risk1_ss1.png" width="400" alt="Alt text">


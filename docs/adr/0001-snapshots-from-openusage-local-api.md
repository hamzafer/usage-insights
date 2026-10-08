# Snapshots come from the OpenUsage local API

Usage Insights records **Snapshots** by reading OpenUsage's local API (`127.0.0.1:6736/v1/usage`)
on a timer, instead of logging into each **Provider** itself or writing history from inside the
OpenUsage fork. OpenUsage already solves every login, keychain and token-refresh problem, and keeping
history outside the fork means it survives if the fork is retired.

## Consequences

- No **Snapshots** are recorded while OpenUsage is not running. Gaps are expected and must be
  visible in the analysis, not silently treated as zero usage.
- A **Provider** is only tracked if it has an OpenUsage card.
- This is a "start here" choice, not a forever one. If depending on OpenUsage starts to hurt
  (gaps, API changes, the fork going away), Usage Insights gets its own logins per **Provider**.
  Keep the code that reads Snapshots behind one small seam so that swap stays cheap.

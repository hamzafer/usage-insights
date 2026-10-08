# Usage Insights

Tracks how much of each AI subscription's allowance actually gets used over time, so the setup
(which provider, model and plan does which job) can be tuned on evidence instead of gut feeling.

## Language

### Allowances

**Provider**:
A subscription that gives a usage allowance, as one card in OpenUsage (Claude, Claude (Work), Codex, Cursor, Copilot).
_Avoid_: tool, service, app

**Window**:
A stretch of time with its own usage limit, which ends at a **Reset**.
_Avoid_: period, bucket

**Session**:
A short **Window** (5 hours for Claude and Codex).
_Avoid_: 5h limit, burst

**Cycle**:
A provider's longest **Window**: weekly for Claude and Codex, monthly for Cursor and Copilot.
_Avoid_: billing period, weekly (as a noun), month

**Reset**:
The moment a **Window** ends and its usage goes back to zero.

**Project**:
One git repository, including its worktrees and subfolders. Usage is split per **Project** only where a **Provider**'s logs record where work happened (Claude Code, Codex).
_Avoid_: repo, folder, workspace

### Analysis

**Waste**:
The share of a **Window**'s allowance still unused at its **Reset**. Counted for both **Sessions** and **Cycles**. A **Session** that never started has no **Waste**; that time is **Idle Capacity**.
_Avoid_: leftover, unused

**Idle Capacity**:
Time within a **Cycle** when no **Session** was open, so its allowance could not be used at all.
_Avoid_: idle waste, dead time

**Limit Hit**:
A **Window** reaching 100% before its **Reset**. The time until that **Reset** is **Blocked Time**.
_Avoid_: rate limit, cap, overrun

**Blocked Time**:
How long a **Provider** was unusable after a **Limit Hit**.

**Overage**:
Money spent on paid usage beyond the plan's allowance (e.g. Claude extra usage, Cursor on-demand). Neither **Waste** nor a **Limit Hit**.
_Avoid_: extra usage, overspend

**Snapshot**:
One recorded reading of a **Provider**'s usage at a point in time.
_Avoid_: sample, poll

**Report**:
A weekly summary (Mondays): final **Waste** for every **Cycle** that reset in the past 7 days, **Pace** for every **Cycle** still running, trends, and **Suggestions**.
_Avoid_: digest, summary, recap

**Pace**:
The **Waste** a running **Cycle** is heading for at its **Reset**, if usage continues at the current rate.
_Avoid_: forecast, projection, burn rate

**Suggestion**:
A concrete change to the **Setup**, written by Claude from the numbers, e.g. "move code reviews to Codex".
_Avoid_: recommendation, tip, insight

**Setup**:
Which **Provider**, plan (and its price) and model is used for which job (coding, reviews, side projects). Written and kept up to date by the user; the source of truth for **Suggestions**.
_Avoid_: config, stack

**Backfill**:
History rebuilt from data that existed before recording started; only where a source allows it.

**Measured** vs **Estimated**:
A **Measured** number comes from a **Snapshot** or a log that records the limit (Codex). An **Estimated** number is converted from tokens (Claude **Backfill**) and is always marked "~". The two are never mixed in one figure.
_Avoid_: approximate, real

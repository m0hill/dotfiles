---
description: Generate a detailed summary of branch changes relative to the fork point
---

Generates a comprehensive summary of the current branch's changes, focusing on architectural updates, new endpoints, and components.

## Workflow

### 1. Determine Base Branch & Divergence Point
First, identify the default branch (usually `main`, `master`, or `develop`) and find the "merge base". The merge base is the exact commit where your branch split off. Comparing against this (instead of the tip of main) ensures we only see YOUR changes, excluding any new code added to main since you started.

```bash
# 1. Identify default branch (fallback to main if detection fails)
DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
echo "Default branch is: $DEFAULT_BRANCH"

# 2. Find the merge base (divergence point)
MERGE_BASE=$(git merge-base $DEFAULT_BRANCH HEAD)
echo "Merge Base Commit: $MERGE_BASE"

# 3. Get Current Branch Name
git branch --show-current

```

### 2. Analyze Changes

Run these commands to gather the data for your summary using the `$MERGE_BASE` calculated above:

```bash
# Get the statistics (files changed, insertions/deletions)
git diff --stat $MERGE_BASE..HEAD

# Get list of new files (A) and modified files (M) to spot new components
git diff --name-status $MERGE_BASE..HEAD

# Read commit history for context
git log $MERGE_BASE..HEAD --pretty=format:"%h - %s"

```

### 3. Generate Report

Analyze the output from Step 2.

* **New Endpoints:** Look for changes in `routes`, `controllers`, or `api` folders.
* **New Components:** Look for new files in `components/`, `views/`, or React/Vue/Angular file extensions.
* **Logic:** If a file has significant changes, you may read the diff using `git diff $MERGE_BASE..HEAD -- path/to/file`.
* **Diffs alone are not enough:** Read the full file(s) being modified to understand context.

**Construct the summary output in this format:**

```markdown
# 🚀 Branch Summary: <Branch Name>

## 📋 Overview
<Brief description of what this branch achieves based on commits and file changes>

## ✨ New Components & Modules
<List newly added files/components with brief descriptions of their inferred purpose>
- `ComponentA.tsx`: <Description>
- `ServiceB.ts`: <Description>

## 🔌 API & Endpoint Changes
<List any new or modified API routes/endpoints detected>

## 🛠️ Architectural & Configuration Changes
<Database migrations, dependency updates (package.json), or core logic shifts>

## 📊 Stats
<Summary stats, e.g., "15 files changed, +300 insertions, -50 deletions">

```

<user-request>
$ARGUMENTS
</user-request>

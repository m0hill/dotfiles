#!/usr/bin/env bash
# Human-in-the-loop reproduction loop.
# Copy this file, edit the steps below, and run it.
# The agent runs the script; the user follows prompts in their terminal.
#
# Usage:
#   bash hitl-loop.template.sh
#
# Two helpers:
#   step "<instruction>"          -> show instruction, wait for Enter
#   capture VAR "<question>"      -> show question, read response into VAR
#
# At the end, captured values are printed as KEY=VALUE for the agent to parse.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

step "Open the app and navigate to the screen or flow that reproduces the bug."

capture REPRODUCED "Did the reported bug occur? (y/n)"

capture SYMPTOM "Paste the exact error/message/visible symptom/timing, or 'none':"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'REPRODUCED=%s\n' "$REPRODUCED"
printf 'SYMPTOM=%s\n' "$SYMPTOM"

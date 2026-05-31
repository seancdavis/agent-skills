#!/bin/bash
# Single-line Claude Code statusline with Nerd Font icons + ANSI color.
# Left:  repo  branch  ticket
# Right: bar pct%  $cost   model

input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
model_id=$(printf '%s' "$input" | jq -r '.model.id // ""')
cwd=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // ""')
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // ""')
cost=$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // 0')
exceeds=$(printf '%s' "$input" | jq -r '.exceeds_200k_tokens // false')

if repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
  repo=$(basename "$repo_root")
else
  repo=$(basename "$cwd")
fi

branch=""
dirty=0
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
  if [ -n "$(git -C "$cwd" status --porcelain 2>/dev/null)" ]; then
    dirty=1
  fi
fi

linear=$(printf '%s' "$branch" | grep -oE '[A-Z]{2,}-[0-9]+' | head -1)

context_pct=0
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  usage_line=$(grep '"usage"' "$transcript" 2>/dev/null | tail -1)
  if [ -n "$usage_line" ]; then
    input_tokens=$(printf '%s' "$usage_line" | jq -r '.message.usage.input_tokens // 0' 2>/dev/null)
    cache_read=$(printf '%s' "$usage_line" | jq -r '.message.usage.cache_read_input_tokens // 0' 2>/dev/null)
    cache_creation=$(printf '%s' "$usage_line" | jq -r '.message.usage.cache_creation_input_tokens // 0' 2>/dev/null)
    total=$((input_tokens + cache_read + cache_creation))

    if [ "$exceeds" = "true" ] || printf '%s%s' "$model_id" "$model" | grep -qi '1m'; then
      cap=1000000
    else
      cap=200000
    fi

    if [ "$cap" -gt 0 ]; then
      context_pct=$((total * 100 / cap))
      [ "$context_pct" -gt 100 ] && context_pct=100
    fi
  fi
fi

# ── Style ──────────────────────────────────────────────────────────────
ESC=$'\e'
R="${ESC}[0m"
DIM="${ESC}[2m"
BOLD="${ESC}[1m"
CYAN="${ESC}[38;5;75m"
YELLOW="${ESC}[38;5;221m"
GREEN="${ESC}[38;5;114m"
RED="${ESC}[38;5;203m"
MAGENTA="${ESC}[38;5;176m"
GRAY="${ESC}[38;5;244m"
DIMGRAY="${ESC}[38;5;240m"

# Nerd Font glyphs
I_REPO=$''    # folder
I_BRANCH=$''  # code branch
I_ISSUE=$''   # issue circle
I_MODEL=$''   # microchip

# Bar gradient by fill level
if   [ "$context_pct" -lt 50 ]; then BAR_COLOR="$GREEN"
elif [ "$context_pct" -lt 80 ]; then BAR_COLOR="$YELLOW"
else                                  BAR_COLOR="$RED"
fi

# Branch color: cyan clean, yellow dirty (no asterisk needed)
if [ "$dirty" -eq 1 ]; then BRANCH_COLOR="$YELLOW"; else BRANCH_COLOR="$CYAN"; fi

filled=$((context_pct / 10))
empty=$((10 - filled))
bar=""
i=0; while [ "$i" -lt "$filled" ]; do bar="${bar}▓"; i=$((i + 1)); done
bar_empty=""
i=0; while [ "$i" -lt "$empty" ]; do bar_empty="${bar_empty}░"; i=$((i + 1)); done

cost_fmt=$(printf '$%.2f' "$cost")

# ── Segments ───────────────────────────────────────────────────────────
seg_repo="${DIMGRAY}${I_REPO}${R} ${BOLD}${repo}${R}"
seg_branch=""
[ -n "$branch" ] && seg_branch="${BRANCH_COLOR}${I_BRANCH} ${branch}${R}"
seg_linear=""
[ -n "$linear" ] && seg_linear="${MAGENTA}${I_ISSUE} ${linear}${R}"
seg_bar="${BAR_COLOR}${bar}${DIMGRAY}${bar_empty}${R} ${BAR_COLOR}${context_pct}%${R}"
seg_cost="${GRAY}${cost_fmt}${R}"
seg_model="${DIM}${I_MODEL} ${model}${R}"

# Join with spacing
join_segments() {
  local out=""
  local sep="   "
  for s in "$@"; do
    [ -z "$s" ] && continue
    if [ -z "$out" ]; then out="$s"; else out="${out}${sep}${s}"; fi
  done
  printf '%s' "$out"
}

left=$(join_segments "$seg_repo" "$seg_branch" "$seg_linear")
right=$(join_segments "$seg_bar" "$seg_cost" "$seg_model")

# ── Right-align ────────────────────────────────────────────────────────
strip_ansi() {
  local s="$1"
  local esc=$'\e'
  while [[ "$s" == *"${esc}["* ]]; do
    local before="${s%%${esc}[*}"
    local rest="${s#*${esc}[}"
    local code="${rest%%m*}"
    local after="${rest#*m}"
    s="${before}${after}"
    case "$code" in
      *[!0-9\;]*) break ;;
    esac
  done
  printf '%s' "$s"
}

cols="${COLUMNS:-0}"
if [ "$cols" -lt 20 ] 2>/dev/null; then cols=$(tput cols 2>/dev/null); fi
if [ -z "$cols" ] || [ "$cols" -lt 20 ] 2>/dev/null; then cols=$(stty size </dev/tty 2>/dev/null | awk '{print $2}'); fi
if [ -z "$cols" ] || [ "$cols" -lt 20 ] 2>/dev/null; then cols=120; fi

left_plain=$(strip_ansi "$left")
right_plain=$(strip_ansi "$right")
pad=$((cols - ${#left_plain} - ${#right_plain}))
[ "$pad" -lt 2 ] && pad=2

printf '%s%*s%s' "$left" "$pad" "" "$right"

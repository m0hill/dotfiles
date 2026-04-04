Review code changes to identify unnecessary complexity, over-engineering, and excessive validation introduced by the "merchant of complexity" developer. Focus on finding simpler alternatives to complex implementations.
Target:
## What to Check
### Unnecessary Complexity Patterns
- **Over-abstraction**: Unneeded interfaces, abstract classes, or factory patterns where simple functions would suffice
- **Premature optimization**: Complex caching, memoization, or micro-optimizations without evidence of performance issues
- **Over-validation**: Redundant null checks, type guards, or assertions where types already guarantee safety
- **Defensive programming excess**: Try-catch blocks around code that cannot throw, excessive error handling for impossible states
- **Unnecessary indirection**: Wrapper functions, proxy patterns, or delegation layers that add no value
- **Over-configurability**: Complex configuration systems for things that should be simple constants
- **Generic overuse**: Generic types/functions when concrete types would be clearer and sufficient
- **State management bloat**: Context providers, stores, or state machines for simple local state
### Unnecessary Validation
- Validating inputs already validated by upstream code
- Type checking in TypeScript code (trust the compiler)
- Null checks on values guaranteed non-null by control flow
- Length/size checks before operations that would safely handle empty collections
- Duplicate validation in multiple layers without purpose
### Over-Engineering Red Flags
- "Future-proofing" for requirements that don't exist
- Adding extension points/interfaces "just in case"
- Implementing full patterns (Strategy, Observer, etc.) for one-off use cases
- Splitting code into too many small files/modules without clear boundaries
- Adding layers "for testability" that make testing harder
## Workflow
### 1. Determine What to Review
```bash
# Default: uncommitted changes
git diff --cached --stat
git diff --stat
# If user provided commit
git show --stat <commit>
# If user provided branch (compare to default branch)
DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
git diff --stat $DEFAULT_BRANCH..<branch>
# If user provided PR number/link - fetch via gh/glab
gh pr view <number> --json headRefName,baseRefName,body
```
### 2. Gather Context
Before reviewing, understand what the code should do:
- Read the PR description or commit message
- Check for linked Linear tickets in PR body (extract issue ID like "CTM-123")
- If Linear issue found, fetch details (LINEAR_API_TOKEN is already in environment):
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_TOKEN" \
  --data '{"query":"{ issue(id: \"CTM-123\") { id title description state { name } assignee { name } priority priorityLabel createdAt updatedAt } }"}' \
  https://api.linear.app/graphql | jq .
```
- Look at related previous reviews for context
### 3. Execute Review
Review the code changes looking for the patterns documented above in "What to Check".
### 4. Synthesize Findings
Correlate results and present as:
```markdown
## Complexity Review Results
### 🔴 High Impact (Must Fix)
1. **[File:line]** - [Issue description]
   - Current: [complex code]
   - Suggested: [simpler alternative]
### 🟡 Medium Impact (Consider)
1. **[File:line]** - [Issue description]
   - Why it matters: [explanation]
### 🟢 Low Impact (Nitpick)
1. **[File:line]** - [Minor simplification opportunity]
```
## Output Format
For each issue found, provide:
- **Location**: Exact file path and line numbers
- **Issue**: What's unnecessarily complex
- **Current approach**: Brief description of the complex code
- **Simpler alternative**: How to achieve the same with less complexity
- **Why it matters**: The cost of the complexity (maintenance, readability, etc.)
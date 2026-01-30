---
description: Review changes with parallel @code-review subagents
agent: plan
---
Review the code changes using THREE (3) @code-review subagents and correlate results into a summary ranked by severity. Use the provided user guidance to steer the review and focus on specific code paths, changes, and/or areas of concern.

Guidance: $ARGUMENTS

Review uncommitted changes by default. If no uncommitted changes, review the last commit. If the user provides a pull request/merge request number or link, use CLI tools (gh/glab) to fetch it and then perform your review. If linear link is present in the gh pr then use this to get the issue details for more information

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_TOKEN" \
  --data '{"query":"{ issue(id: \"CTM-123\") { id title description state { name } assignee { name } priority priorityLabel createdAt updatedAt comments { nodes { body createdAt user { name } } } } }"}' \
  https://api.linear.app/graphql | jq .
```

Also check if there were any previous code reviews done already using gh cli. Example request:

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviews(first:100) {
        nodes {
          author { login }
          state
          submittedAt
          body
          comments(first:100) {
            nodes {
              author { login }
              createdAt
              body
              path
              line
              originalLine
              diffHunk
              url
            }
          }
        }
      }
    }
  }
}
' -f owner="sind-ai" -f repo="kirokun-backend" -F number="103" \
| jq --arg me "$(gh api user -q .login)" '
  .data.repository.pullRequest.reviews.nodes
  | map(select(.author.login == $me))
  | map({
      submittedAt,
      state,
      body,
      comments: (.comments.nodes | map({
        createdAt, path, line, originalLine, body, diffHunk, url
      }))
    })
'
```
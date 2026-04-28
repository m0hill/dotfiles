---
name: linear
description: You will be given a task related to linear issues, your job is to use the linear graohql api and help with that task. The `LINEAR_API_TOKEN` is already present in the environment so do not prompt the user for that. Identify the relevant task based on context or checking the current branch. Branch names could be in these formats `mohil/CTM-123`, `123`, `CTM-123`, `ctm-123` `mohil/ctm-123`. The issue ID is the part after the first slash and before the second dash, in this case `CTM-123`. Use the GraphQL API to get details about the issue and help with the task at hand.
---

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_TOKEN" \
  --data '{"query":"{ issue(id: \"CTM-123\") { id title description state { name } assignee { name } priority priorityLabel createdAt updatedAt comments { nodes { body createdAt user { name } } } } }"}' \
  https://api.linear.app/graphql | jq .
```

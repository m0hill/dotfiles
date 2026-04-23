---
description: All tasks related to linear
---
You will be given a task related to linear issues, your job is to use the linear graohql api and help with that task. The `LINEAR_API_TOKEN` is already present in the environment so do not prompt the user for that.

Guidance: $ARGUMENTS

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_TOKEN" \
  --data '{"query":"{ issue(id: \"CTM-123\") { id title description state { name } assignee { name } priority priorityLabel createdAt updatedAt comments { nodes { body createdAt user { name } } } } }"}' \
  https://api.linear.app/graphql | jq .
```

---
name: prod-deployment-audit
description: Read-only ECS deployment and ECR Git provenance audit.
disable-model-invocation: true
---

# Production deployment audit

Use the evidence chain: **running ECS digest → ECR provenance → Git commit**.
Read `../aws-accounts/SKILL.md` first; keep all AWS operations read-only.

1. Verify each account with `sts get-caller-identity`. Production ECS and shared
   ECR may be in different accounts. For SIND, use `sind-prod-view` for ECS and
   CloudTrail, and `sind-cicd` for ECR; confirm identities rather than assuming.
2. Run ECS `describe-services`, `list-tasks`, and `describe-tasks`. Record each
   app container's image URI and **every running task's imageDigest**; report
   differing digests instead of assuming a uniform rollout.
3. In ECR, run `describe-images` for the requested tag (usually `main`). Record
   its digest and `imagePushedAt`; compare with ECS. Trace the **running digest**
   even if the tag now points elsewhere.
4. Retrieve provenance using ECR:
   - `batch-get-image --repository-name <repo> --image-ids imageDigest=<digest>`.
   - Parse `imageManifest`; select the index entry whose annotation
     `vnd.docker.reference.type` is `attestation-manifest`.
   - Fetch that entry with `batch-get-image` by its digest.
   - For its provenance layer, use `get-download-url-for-layer` and fetch the
     returned URL. Keep signed URLs out of the report.
   - Read the SLSA statement's Git SHA at
     `predicate.metadata["https://mobyproject.org/buildkit@v1#metadata"].vcs.revision`.
   - Resolve it with `git show -s --format='%H %cI %s' <sha>` in the matching repo.
5. Confirm deployment timing with CloudTrail `lookup-events` for `UpdateService`,
   filtering the target service through the present. Explicit redeploys have
   `forceNewDeployment: true`; autoscaling usually changes desired count with
   it false. Inspect other configuration/task-definition changes separately.
   ECS deployment `createdAt` is supporting evidence; task starts, `updatedAt`,
   and steady-state events are not release timestamps.
6. Report account/region, service, deployment trigger time/actor, image push
   time, digest, and provenance SHA/message. Convert timestamps explicitly to
   **Asia/Tokyo (JST, UTC+9)**. Distinguish redeploying an image from releasing code.

Local version bumps do not prove deployment. Prefer provenance to Docker labels
or Colima cache. If provenance is absent, label code-content matches as inferred;
if access/history is unavailable, state the gap rather than claiming certainty.
